import Darwin
import IOKit

// topo-fan-control: reads fan state from the SMC and, as root, holds the fans at max speed.
//   status                                          -> one JSON line, no privileges needed
//   hold --parent-pid <pid> --lease <abs> [--dry-run] -> forces max until the lease is removed,
//                                                     the parent dies, or a signal arrives;
//                                                     always restores the original fan mode.

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
  static let bytes = 48
}

private enum SmcSelector: UInt8 {
  case read = 5
  case write = 6
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

// MARK: - hold

struct HoldArguments {
  let parentPid: pid_t
  let leasePath: String
  let dryRun: Bool
}

func parseHoldArguments(_ args: ArraySlice<String>) -> HoldArguments? {
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
  return HoldArguments(parentPid: parentPid, leasePath: leasePath, dryRun: dryRun)
}

private func processUid(_ pid: pid_t) -> uid_t? {
  var info = proc_bsdinfo()
  let size = Int32(MemoryLayout<proc_bsdinfo>.size)
  guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
  return info.pbi_uid
}

/// Opens the lease without following links and only if it is a plain file owned by the parent's user,
/// because the real hold writes it as root.
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

/// Remembers each fan's original mode so every exit path can hand control back to macOS.
final class FanHold {
  private let smc: Smc
  private var originalModes: [Int: Double] = [:]

  init(smc: Smc) { self.smc = smc }

  func forceMax() -> Bool {
    let count = fanCount(smc)
    guard count > 0 else { return false }
    for index in 0..<count {
      guard let mode = smc.readNumber(modeKey(index)) else { return false }
      originalModes[index] = mode
    }
    return reassert()
  }

  @discardableResult
  func reassert() -> Bool {
    originalModes.keys.sorted().allSatisfy { index in
      guard let maxRpm = smc.readNumber("F\(index)Mx"), maxRpm > 0 else { return false }
      return smc.write(modeKey(index), [1]) && smc.writeNumber("F\(index)Tg", maxRpm)
    }
  }

  func restore() {
    for (index, mode) in originalModes {
      _ = smc.write(modeKey(index), [UInt8(clamping: Int(mode))])
    }
    originalModes.removeAll()
  }
}

func runHold(_ args: ArraySlice<String>) -> ExitCode {
  guard let arguments = parseHoldArguments(args), processAlive(arguments.parentPid),
    let lease = openLease(arguments.leasePath, ownerPid: arguments.parentPid)
  else { return .invalidArgs }
  defer { close(lease) }
  installStopSignals()

  var hold: FanHold?
  if !arguments.dryRun {
    guard let smc = Smc() else {
      writeLease(lease, "write-rejected")
      return .writeRejected
    }
    let fanHold = FanHold(smc: smc)
    hold = fanHold
    guard fanHold.forceMax() else {
      fanHold.restore()
      writeLease(lease, "write-rejected")
      return .writeRejected
    }
  }
  defer { hold?.restore() }
  writeLease(lease, "ready")

  var ticks = 0
  while stopRequested == 0, processAlive(arguments.parentPid),
    !leaseRemoved(lease, path: arguments.leasePath)
  {
    usleep(200_000)
    ticks += 1
    // macOS can reclaim the fans after sleep/wake; re-apply max every few seconds.
    if ticks % 25 == 0 { hold?.reassert() }
  }
  return .ok
}

// MARK: - entry

let arguments = CommandLine.arguments.dropFirst()
let exitCode: ExitCode
switch arguments.first {
case "status" where arguments.count == 1:
  exitCode = runStatus()
case "hold":
  exitCode = runHold(arguments.dropFirst())
default:
  exitCode = .invalidArgs
}
exit(exitCode.rawValue)
