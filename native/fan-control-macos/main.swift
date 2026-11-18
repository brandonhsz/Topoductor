import Darwin
import IOKit

// topo-fan-control: reads fan state and temperatures from the SMC and, as root, drives fan targets.
//   status                                             -> one JSON line, no privileges needed
//   sensors                                            -> one JSON line of chip/palm-rest/battery temps
//   control --parent-pid <pid> --lease <abs> [--dry-run] -> applies the per-fan targets main writes to
//                                                        the lease until it is removed, the parent dies,
//                                                        or a signal arrives; always restores fan modes.

enum ExitCode: Int32 {
  case ok = 0
  case failure = 1
  case invalidArgs = 2
  case writeRejected = 3
}

// MARK: - SMC access

// Byte offsets of the AppleSMC SMCKeyData_t struct (80 bytes, natural C alignment).
private enum SmcLayout {
  static let size = 80
  static let key = 0
  static let dataSize = 28
  static let dataType = 32
  static let result = 40
  static let selector = 42
  static let index = 44
  static let bytes = 48
}

private enum SmcSelector: UInt8 {
  case read = 5
  case write = 6
  case keyAtIndex = 8
  case keyInfo = 9
}

private func fourCC(_ text: String) -> UInt32 {
  text.utf8.reduce(0) { ($0 << 8) | UInt32($1) }
}

private func fourCCString(_ value: UInt32) -> String {
  String(decoding: [24, 16, 8, 0].map { UInt8((value >> $0) & 0xff) }, as: UTF8.self)
}

struct SmcValue {
  let type: String
  let bytes: [UInt8]
}

final class Smc {
  private var connection: io_connect_t = 0

  init?() {
    let service = IOServiceGetMatchingService(mach_port_t(MACH_PORT_NULL), IOServiceMatching("AppleSMC"))
    guard service != 0 else { return nil }
    defer { IOObjectRelease(service) }
    guard IOServiceOpen(service, mach_task_self_, 0, &connection) == KERN_SUCCESS else { return nil }
  }

  deinit {
    IOServiceClose(connection)
  }

  private func call(_ input: [UInt8]) -> [UInt8]? {
    var output = [UInt8](repeating: 0, count: SmcLayout.size)
    var outputSize = SmcLayout.size
    let result = input.withUnsafeBytes { inputPointer in
      output.withUnsafeMutableBytes { outputPointer in
        IOConnectCallStructMethod(
          connection, 2, inputPointer.baseAddress, SmcLayout.size,
          outputPointer.baseAddress, &outputSize)
      }
    }
    guard result == KERN_SUCCESS, output[SmcLayout.result] == 0 else { return nil }
    return output
  }

  private func request(_ key: String, _ selector: SmcSelector) -> [UInt8] {
    var input = [UInt8](repeating: 0, count: SmcLayout.size)
    store(fourCC(key), into: &input, at: SmcLayout.key)
    input[SmcLayout.selector] = selector.rawValue
    return input
  }

  private func keyInfo(_ key: String) -> (size: UInt32, type: UInt32)? {
    guard let output = call(request(key, .keyInfo)) else { return nil }
    return (load(output, at: SmcLayout.dataSize), load(output, at: SmcLayout.dataType))
  }

  func read(_ key: String) -> SmcValue? {
    guard let info = keyInfo(key), info.size <= 32 else { return nil }
    var input = request(key, .read)
    store(info.size, into: &input, at: SmcLayout.dataSize)
    guard let output = call(input) else { return nil }
    let start = SmcLayout.bytes
    return SmcValue(
      type: fourCCString(info.type), bytes: Array(output[start..<start + Int(info.size)]))
  }

  func write(_ key: String, _ bytes: [UInt8]) -> Bool {
    guard let info = keyInfo(key), Int(info.size) == bytes.count else { return false }
    var input = request(key, .write)
    store(info.size, into: &input, at: SmcLayout.dataSize)
    for (offset, byte) in bytes.enumerated() {
      input[SmcLayout.bytes + offset] = byte
    }
    return call(input) != nil
  }

  func readNumber(_ key: String) -> Double? {
    guard let value = read(key) else { return nil }
    return decodeNumber(value)
  }

  func keyCount() -> Int {
    guard let value = read("#KEY") else { return 0 }
    return value.bytes.reduce(0) { ($0 << 8) | Int($1) }
  }

  func key(at index: Int) -> String? {
    var input = [UInt8](repeating: 0, count: SmcLayout.size)
    input[SmcLayout.selector] = SmcSelector.keyAtIndex.rawValue
    store(UInt32(index), into: &input, at: SmcLayout.index)
    guard let output = call(input) else { return nil }
    return fourCCString(load(output, at: SmcLayout.key))
  }

  /// Encodes `number` in the same SMC type the key already uses.
  func writeNumber(_ key: String, _ number: Double) -> Bool {
    guard let current = read(key), let bytes = encodeNumber(number, type: current.type) else {
      return false
    }
    return write(key, bytes)
  }
}

private func store(_ value: UInt32, into buffer: inout [UInt8], at offset: Int) {
  withUnsafeBytes(of: value) { raw in
    for index in 0..<4 { buffer[offset + index] = raw[index] }
  }
}

private func load(_ buffer: [UInt8], at offset: Int) -> UInt32 {
  var value: UInt32 = 0
  withUnsafeMutableBytes(of: &value) { raw in
    for index in 0..<4 { raw[index] = buffer[offset + index] }
  }
  return value
}

private func decodeNumber(_ value: SmcValue) -> Double? {
  let bytes = value.bytes
  switch value.type {
  case "flt " where bytes.count == 4:
    return Double(Float(bitPattern: load(bytes, at: 0)))
  case "fpe2" where bytes.count == 2:
    return Double((UInt16(bytes[0]) << 8) | UInt16(bytes[1])) / 4
  case "sp78" where bytes.count == 2:
    return Double(Int16(bitPattern: (UInt16(bytes[0]) << 8) | UInt16(bytes[1]))) / 256
  case "ui8 " where bytes.count == 1:
    return Double(bytes[0])
  case "ui16" where bytes.count == 2:
    return Double((UInt16(bytes[0]) << 8) | UInt16(bytes[1]))
  default:
    return nil
  }
}

private func encodeNumber(_ number: Double, type: String) -> [UInt8]? {
  switch type {
  case "flt ":
    return withUnsafeBytes(of: Float(number).bitPattern.littleEndian) { Array($0) }
  case "fpe2":
    let raw = UInt16(clamping: Int(number * 4))
    return [UInt8(raw >> 8), UInt8(raw & 0xff)]
  default:
    return nil
  }
}

// MARK: - Fan model

struct FanReading {
  let index: Int
  let rpm: Int
  let minRpm: Int
  let maxRpm: Int
}

private func fanCount(_ smc: Smc) -> Int {
  Int(smc.readNumber("FNum") ?? 0)
}

private func modeKey(_ index: Int) -> String { "F\(index)Md" }

private func readFans(_ smc: Smc) -> [FanReading] {
  (0..<fanCount(smc)).map { index in
    FanReading(
      index: index,
      rpm: Int((smc.readNumber("F\(index)Ac") ?? 0).rounded()),
      minRpm: Int((smc.readNumber("F\(index)Mn") ?? 0).rounded()),
      maxRpm: Int((smc.readNumber("F\(index)Mx") ?? 0).rounded()))
  }
}

private func printJsonLine(_ json: String) {
  print(json)
  fflush(stdout)
}

private func jsonString(_ text: String) -> String {
  "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
}

private extension String {
  func replacingOccurrences(of target: String, with replacement: String) -> String {
    split(separator: Character(target), omittingEmptySubsequences: false).joined(separator: replacement)
  }
}

// MARK: - status

func runStatus() -> ExitCode {
  guard let smc = Smc() else {
    printJsonLine("{\"error\":\(jsonString("cannot open AppleSMC"))}")
    return .failure
  }
  let fans = readFans(smc)
  let manual = (0..<fans.count).contains { smc.readNumber(modeKey($0)) == 1 }
  let fanJson = fans.map {
    "{\"index\":\($0.index),\"rpm\":\($0.rpm),\"minRpm\":\($0.minRpm),\"maxRpm\":\($0.maxRpm)}"
  }
  printJsonLine("{\"fans\":[\(fanJson.joined(separator: ","))],\"mode\":\"\(manual ? "manual" : "auto")\"}")
  return .ok
}

// MARK: - sensors

private enum SensorGroup: CaseIterable {
  case chip, palmrest, battery

  var name: String {
    switch self {
    case .chip: return "chip"
    case .palmrest: return "palmrest"
    case .battery: return "battery"
    }
  }

  // Apple does not document these keys and they vary by model; verified on Apple Silicon (M2 Pro).
  static func of(_ key: String) -> SensorGroup? {
    if key.hasPrefix("Tp") || key.hasPrefix("Te") { return .chip }
    if key == "Ts0P" || key == "Ts1P" { return .palmrest }
    if key.hasPrefix("TB") && key.hasSuffix("T") { return .battery }
    return nil
  }
}

private let plausibleCelsius = 5.0..<130.0

private func isJsonSafeKey(_ key: String) -> Bool {
  key.utf8.count == 4 && key.utf8.allSatisfy { $0 >= 0x20 && $0 < 0x7f && $0 != 0x22 && $0 != 0x5c }
}

/// The SMC keeps its key table sorted, so the T* range is found by bisection instead of a ~0.6 s sweep.
private func temperatureKeys(_ smc: Smc) -> [String] {
  let count = smc.keyCount()
  var low = 0
  var high = count
  while low < high {
    let middle = (low + high) / 2
    guard let key = smc.key(at: middle) else { return [] }
    if key.utf8.lexicographicallyPrecedes("T".utf8) { low = middle + 1 } else { high = middle }
  }
  var keys: [String] = []
  for index in low..<count {
    guard let key = smc.key(at: index), key.hasPrefix("T") else { break }
    keys.append(key)
  }
  return keys
}

func runSensors() -> ExitCode {
  guard let smc = Smc() else {
    printJsonLine("{\"error\":\(jsonString("cannot open AppleSMC"))}")
    return .failure
  }
  var groups: [SensorGroup: [String]] = [:]
  for key in temperatureKeys(smc) {
    guard isJsonSafeKey(key),
      let group = SensorGroup.of(key), let celsius = smc.readNumber(key),
      plausibleCelsius.contains(celsius)
    else { continue }
    let rounded = (celsius * 10).rounded() / 10
    groups[group, default: []].append("{\"key\":\"\(key)\",\"c\":\(rounded)}")
  }
  let body = SensorGroup.allCases.map { group in
    "\"\(group.name)\":[\((groups[group] ?? []).joined(separator: ","))]"
  }
  printJsonLine("{\(body.joined(separator: ","))}")
  return .ok
}

// MARK: - control

struct ControlArguments {
  let parentPid: pid_t
  let leasePath: String
  let dryRun: Bool
}

func parseControlArguments(_ args: ArraySlice<String>) -> ControlArguments? {
  var parentPid: pid_t?
  var leasePath: String?
  var dryRun = false
  var iterator = args.makeIterator()
  while let flag = iterator.next() {
    switch flag {
    case "--parent-pid":
      guard parentPid == nil, let value = iterator.next(), !value.isEmpty,
        value.allSatisfy({ $0.isASCII && $0.isNumber }), let pid = pid_t(value), pid > 1
      else { return nil }
      parentPid = pid
    case "--lease":
      guard leasePath == nil, let value = iterator.next(), value.hasPrefix("/"),
        !value.contains("\0")
      else { return nil }
      leasePath = value
    case "--dry-run":
      guard !dryRun else { return nil }
      dryRun = true
    default:
      return nil
    }
  }
  guard let parentPid, let leasePath else { return nil }
  return ControlArguments(parentPid: parentPid, leasePath: leasePath, dryRun: dryRun)
}

private func processUid(_ pid: pid_t) -> uid_t? {
  var info = proc_bsdinfo()
  let size = Int32(MemoryLayout<proc_bsdinfo>.size)
  guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
  return info.pbi_uid
}

/// Opens the lease without following links and only if it is a plain file owned by the parent's user,
/// because the real control session reads and writes it as root.
private func openLease(_ path: String, ownerPid: pid_t) -> Int32? {
  let descriptor = open(path, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
  guard descriptor >= 0 else { return nil }
  var info = stat()
  guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_nlink == 1,
    let ownerUid = processUid(ownerPid), info.st_uid == ownerUid
  else {
    close(descriptor)
    return nil
  }
  return descriptor
}

private func writeLease(_ descriptor: Int32, _ text: String) {
  let bytes = Array((text + "\n").utf8)
  _ = ftruncate(descriptor, 0)
  _ = bytes.withUnsafeBytes { pwrite(descriptor, $0.baseAddress, bytes.count, 0) }
  _ = fsync(descriptor)
}

private let maxLeaseBytes = 512

/// Reads the whole lease through the already-verified descriptor.
private func readLease(_ descriptor: Int32) -> [UInt8]? {
  var buffer = [UInt8](repeating: 0, count: maxLeaseBytes + 1)
  let count = buffer.withUnsafeMutableBytes { pread(descriptor, $0.baseAddress, maxLeaseBytes + 1, 0) }
  guard count >= 0, count <= maxLeaseBytes else { return nil }
  return Array(buffer[0..<count])
}

private func leaseRemoved(_ descriptor: Int32, path: String) -> Bool {
  var opened = stat()
  var current = stat()
  guard fstat(descriptor, &opened) == 0, opened.st_nlink > 0 else { return true }
  guard lstat(path, &current) == 0 else { return true }
  return current.st_ino != opened.st_ino || current.st_dev != opened.st_dev
}

private func processAlive(_ pid: pid_t) -> Bool {
  kill(pid, 0) == 0 || errno == EPERM
}

private var stopRequested: sig_atomic_t = 0

private func installStopSignals() {
  for signalNumber in [SIGINT, SIGTERM, SIGHUP, SIGQUIT] {
    signal(signalNumber) { _ in stopRequested = 1 }
  }
  signal(SIGPIPE, SIG_IGN)
}

private let targetsVersion = 1
private let maxTargets = 16
private let targetsPrefix = "{\"v\":\(targetsVersion),\"targets\":["
private let targetsSuffix = "]}"

/// Parses exactly the line main's serializeFanTargets writes; anything else (pending, ready,
/// a torn write, another version) is nil, which hands every fan to macOS.
func parseTargetsLine(_ bytes: [UInt8]) -> [Double?]? {
  guard bytes.allSatisfy({ $0 < 0x80 }) else { return nil }
  let line = String(decoding: bytes, as: UTF8.self).trimmingWhitespace()
  guard line.hasPrefix(targetsPrefix), line.hasSuffix(targetsSuffix),
    line.count >= targetsPrefix.count + targetsSuffix.count
  else { return nil }
  let list = line.dropFirst(targetsPrefix.count).dropLast(targetsSuffix.count)
  if list.isEmpty { return [] }
  let items = list.split(separator: ",", omittingEmptySubsequences: false)
  guard items.count <= maxTargets else { return nil }
  var targets: [Double?] = []
  for item in items {
    if item == "null" {
      targets.append(nil)
    } else if item.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == "." || $0 == "-") }),
      let rpm = Double(item), rpm.isFinite
    {
      targets.append(rpm)
    } else {
      return nil
    }
  }
  return targets
}

private extension String {
  func trimmingWhitespace() -> String {
    let isSpace: (Character) -> Bool = { $0 == " " || $0 == "\n" || $0 == "\r" || $0 == "\t" }
    guard let first = firstIndex(where: { !isSpace($0) }),
      let last = lastIndex(where: { !isSpace($0) })
    else { return "" }
    return String(self[first...last])
  }
}

private func targetsJson(_ targets: [Double?]) -> String {
  let items = targets.map { target -> String in
    guard let target else { return "null" }
    return target == target.rounded() && abs(target) < 1e9 ? String(Int(target)) : String(target)
  }
  return targetsPrefix + items.joined(separator: ",") + targetsSuffix
}

private enum FanTarget: Equatable {
  case auto
  case rpm(Double)
}

private struct FanLimits {
  let minRpm: Double
  let maxRpm: Double
}

/// Owns the fans for the session; every exit path hands them back to macOS (FxMd 0).
final class FanControl {
  private let smc: Smc
  private var fanIndexes: [Int] = []
  private var limits: [Int: FanLimits] = [:]
  private var applied: [Int: FanTarget] = [:]

  init(smc: Smc) { self.smc = smc }

  /// Hands every fan to macOS; the write doubles as a root check.
  func begin() -> Bool {
    let count = fanCount(smc)
    guard count > 0 else { return false }
    for index in 0..<count {
      guard smc.readNumber(modeKey(index)) != nil else { return false }
      fanIndexes.append(index)
      if let minRpm = smc.readNumber("F\(index)Mn"), let maxRpm = smc.readNumber("F\(index)Mx"),
        minRpm > 0, maxRpm >= minRpm
      {
        limits[index] = FanLimits(minRpm: minRpm, maxRpm: maxRpm)
      }
    }
    return apply(Array(repeating: nil, count: count), force: true)
  }

  /// Unknown limits, missing entries and non-positive rpm all mean macOS keeps that fan.
  private func target(for index: Int, in targets: [Double?]) -> FanTarget {
    guard index < targets.count, let rpm = targets[index], rpm > 0, let limit = limits[index] else {
      return .auto
    }
    return .rpm(min(max(rpm, limit.minRpm), limit.maxRpm).rounded())
  }

  /// Writes only fans whose target changed unless `force`, which macOS needs after sleep/wake.
  /// Never re-reads FxMd to validate: mode writes land with up to a second of lag.
  @discardableResult
  func apply(_ targets: [Double?], force: Bool = false) -> Bool {
    var ok = true
    for index in fanIndexes {
      let next = target(for: index, in: targets)
      guard force || applied[index] != next else { continue }
      let written: Bool
      switch next {
      case .auto:
        written = smc.write(modeKey(index), [0])
      case .rpm(let rpm):
        written = smc.write(modeKey(index), [1]) && smc.writeNumber("F\(index)Tg", rpm)
      }
      if written {
        applied[index] = next
      } else {
        applied[index] = nil
        ok = false
      }
    }
    return ok
  }

  /// Always auto, never the mode found at begin(): that may be a crashed session's stale manual.
  func restore() {
    for index in fanIndexes {
      _ = smc.write(modeKey(index), [0])
    }
    fanIndexes.removeAll()
  }
}

func runControl(_ args: ArraySlice<String>) -> ExitCode {
  guard let arguments = parseControlArguments(args), processAlive(arguments.parentPid),
    let lease = openLease(arguments.leasePath, ownerPid: arguments.parentPid)
  else { return .invalidArgs }
  defer { close(lease) }
  installStopSignals()

  var control: FanControl?
  if !arguments.dryRun {
    guard let smc = Smc() else {
      writeLease(lease, "write-rejected")
      return .writeRejected
    }
    let fanControl = FanControl(smc: smc)
    control = fanControl
    guard fanControl.begin() else {
      fanControl.restore()
      writeLease(lease, "write-rejected")
      return .writeRejected
    }
  }
  defer { control?.restore() }
  writeLease(lease, "ready")

  var appliedBytes: [UInt8]? = nil
  var previousBytes: [UInt8]? = nil
  var ticks = 0
  var targets: [Double?] = []
  while stopRequested == 0, processAlive(arguments.parentPid),
    !leaseRemoved(lease, path: arguments.leasePath)
  {
    // An unreadable or oversized lease parses as nil, handing every fan to macOS.
    let bytes = readLease(lease) ?? []
    // Main rewrites the lease in place, so a read can land mid-write; act only on a line seen twice.
    if bytes == previousBytes, bytes != appliedBytes {
      appliedBytes = bytes
      let parsed = parseTargetsLine(bytes)
      targets = parsed ?? []
      control?.apply(targets)
      if arguments.dryRun, let parsed { printJsonLine(targetsJson(parsed)) }
    }
    previousBytes = bytes
    usleep(200_000)
    ticks += 1
    // macOS reclaims the fans after sleep/wake; re-apply every few seconds.
    if ticks % 25 == 0 { control?.apply(targets, force: true) }
  }
  return .ok
}

// MARK: - entry

let arguments = CommandLine.arguments.dropFirst()
let exitCode: ExitCode
switch arguments.first {
case "status" where arguments.count == 1:
  exitCode = runStatus()
case "sensors" where arguments.count == 1:
  exitCode = runSensors()
case "control":
  exitCode = runControl(arguments.dropFirst())
default:
  exitCode = .invalidArgs
}
exit(exitCode.rawValue)
