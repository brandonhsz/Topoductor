// Drives the mercadolibre.com.mx tab of Topo's browser through the `topo` CLI: the affiliate
// session lives there, and plugins have no browser API of their own.
import { execFile } from 'node:child_process'
import { amount, field, records, text, toCardReading } from './json-fields'
import type { MeliReading, SearchCandidate } from './protocol'
import {
  canonicalUrlExpression,
  generateLinksExpression,
  LINKBUILDER_BATCH,
  LINKBUILDER_URL,
  readCardsExpression,
  SEARCH_RESULTS_EXPRESSION,
  searchUrl,
  SESSION_EXPRESSION
} from './meli-page-scripts'

export type CliRunner = (args: string[], timeoutMs: number) => Promise<unknown>

export type CardReading = MeliReading & { url: string }

export type ReferralResult = { url: string; referral: string | null; reason: string | null }

export type MeliClient = {
  readCards(
    urls: readonly string[],
    onBatch: (batch: CardReading[]) => Promise<void>
  ): Promise<void>
  generateReferrals(urls: readonly string[]): Promise<ReferralResult[]>
  canonicalUrl(
    url: string
  ): Promise<{ status: number; canonical: string | null; unavailable: boolean }>
  search(query: string): Promise<SearchResult[]>
}

/** A search result as the page shows it; the worker turns `imageUrl` into the panel's image. */
export type SearchResult = Omit<SearchCandidate, 'image'> & { imageUrl: string | null }

export class MeliSessionError extends Error {}

const READ_BATCH = 24

const HOME_URL = 'https://www.mercadolibre.com.mx/'

export function cliRunner(cliPath: string): CliRunner {
  return (args, timeoutMs) =>
    new Promise((resolve, reject) => {
      execFile(
        cliPath,
        [...args, '--json'],
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) => {
          let parsed: { ok?: boolean; result?: unknown; error?: { message?: string } } | null = null
          try {
            parsed = JSON.parse(stdout)
          } catch {
            parsed = null
          }
          if (parsed?.ok) {
            resolve(parsed.result)
            return
          }
          reject(new Error(parsed?.error?.message ?? error?.message ?? 'topo no respondió'))
        }
      )
    })
}

/** `worktreeId` is the workspace holding the tab, to bring it on screen. */
export type Tab = { browserPageId: string; url: string; worktreeId?: string }

export class MeliBrowser {
  private readonly workspace: string | null
  private readonly profile: string | null

  /**
   * `workspacePath`: the Topo workspace whose browser to use; any workspace when empty.
   * `profileId`: the browser profile (account) to use; empty: the default one. A machine that
   * also buys in MercadoLibre keeps its buying tab in the default profile, so the catalog uses its
   * own profile and never takes that tab.
   */
  constructor(
    readonly run: CliRunner,
    workspacePath?: string,
    profileId?: string
  ) {
    this.workspace = workspacePath?.trim().replace(/\/+$/, '') || null
    this.profile = profileId?.trim() || null
  }

  private inProfile(profileId: string | null): boolean {
    return (profileId || 'default') === (this.profile ?? 'default') || (!this.profile && !profileId)
  }

  private inWorkspace(worktreeId: string | null): boolean {
    return !this.workspace || (worktreeId ?? '').endsWith(`::${this.workspace}`)
  }

  async findTab(): Promise<Tab> {
    const listed = await this.run(['tab', 'list', '--worktree', 'all'], 20_000)
    const tab = records(field(listed, 'tabs')).find(
      (candidate) =>
        /^https:\/\/[a-z]+\.mercadolibre\.com\.mx\//.test(text(candidate.url) ?? '') &&
        this.inWorkspace(text(candidate.worktreeId)) &&
        this.inProfile(text(candidate.profileId))
    )
    const tabId = text(tab?.browserPageId)
    if (tab && tabId) {
      return {
        browserPageId: tabId,
        url: text(tab.url) ?? '',
        worktreeId: text(tab.worktreeId) ?? undefined
      }
    }
    // The worker runs outside any workspace, so `--worktree active` cannot resolve: name one.
    const worktrees = records(field(await this.run(['worktree', 'list'], 20_000), 'worktrees'))
    const worktreeId = text(worktrees.find((worktree) => this.inWorkspace(text(worktree.id)))?.id)
    if (!worktreeId) {
      throw new MeliSessionError(
        this.workspace
          ? `No encontré el workspace ${this.workspace} en Topo: revisa el ajuste «Workspace del navegador».`
          : 'Abre un workspace en Topo para poder usar MercadoLibre.'
      )
    }
    const created = await this.run(
      [
        'tab',
        'create',
        '--url',
        LINKBUILDER_URL,
        '--worktree',
        `id:${worktreeId}`,
        ...(this.profile ? ['--profile', this.profile] : [])
      ],
      30_000
    )
    const createdId = text(field(created, 'browserPageId'))
    if (!createdId) {
      throw new MeliSessionError('No se pudo abrir MercadoLibre en el navegador de Topo.')
    }
    return { browserPageId: createdId, url: LINKBUILDER_URL, worktreeId }
  }

  /**
   * Clicks the button named `button` inside the open dialog whose title matches `dialog`, through
   * Topo's accessibility snapshot: it reaches menus and iframes a page script cannot click.
   */
  async clickInDialog(tab: Tab, dialog: RegExp, button: string): Promise<boolean> {
    const snapshot =
      text(field(await this.run(['snapshot', '--page', tab.browserPageId], 30_000), 'snapshot')) ??
      ''
    const lines = snapshot.split('\n')
    const start = lines.findIndex((line) => /dialog "/.test(line) && dialog.test(line))
    const ref =
      start === -1
        ? null
        : lines
            .slice(start + 1)
            .map((line) => new RegExp(`button "${button}" \\[ref=(e\\d+)\\]`).exec(line)?.[1])
            .find((found) => found !== undefined)
    if (!ref) {
      return false
    }
    const worktree = tab.worktreeId ? ['--worktree', `id:${tab.worktreeId}`] : []
    await this.run(['click', '--element', ref, ...worktree], 30_000)
    return true
  }

  async evaluate(pageId: string, expression: string, timeoutMs = 60_000): Promise<unknown> {
    const answer = field(
      await this.run(['eval', '--page', pageId, '--expression', expression], timeoutMs),
      'result'
    )
    const parsed: unknown = typeof answer === 'string' ? JSON.parse(answer) : answer
    return parsed
  }

  private async openLinkBuilder(): Promise<string> {
    const tab = await this.findTab()
    if (!tab.url.startsWith(LINKBUILDER_URL)) {
      await this.run(['goto', '--page', tab.browserPageId, '--url', LINKBUILDER_URL], 45_000)
    }
    await this.run(['wait', '--page', tab.browserPageId, '--selector', '#url-0'], 30_000).catch(
      () => undefined
    )
    const session = await this.evaluate(tab.browserPageId, SESSION_EXPRESSION)
    if (!text(field(session, 'tag'))) {
      throw new MeliSessionError(
        'Inicia sesión con la cuenta de afiliados en la pestaña de MercadoLibre del navegador de Topo.'
      )
    }
    return tab.browserPageId
  }

  /**
   * Any page of www.mercadolibre.com.mx: the meli.la iframes need that origin, not an account.
   * Prices are public, so reading them works logged out or with any account.
   */
  private async openMeliPage(): Promise<string> {
    const tab = await this.findTab()
    if (!tab.url.startsWith(HOME_URL)) {
      await this.run(['goto', '--page', tab.browserPageId, '--url', HOME_URL], 45_000)
      await this.run(['wait', '--page', tab.browserPageId, '--load', 'load'], 30_000).catch(
        () => undefined
      )
    }
    return tab.browserPageId
  }

  /** Reads every meli.la, calling `onBatch` as each batch lands so progress survives a stop. */
  async readCards(
    urls: readonly string[],
    onBatch: (batch: CardReading[]) => Promise<void>
  ): Promise<void> {
    const pageId = await this.openMeliPage()
    for (let index = 0; index < urls.length; index += READ_BATCH) {
      const raw = await this.evaluate(
        pageId,
        readCardsExpression(urls.slice(index, index + READ_BATCH)),
        120_000
      )
      const checkedAt = Date.now()
      const batch = records(raw).map((reading) => toCardReading(reading, checkedAt))
      if (batch.length > 0 && batch.every((reading) => reading.blocked)) {
        throw new MeliSessionError(
          'MercadoLibre pidió verificación: complétala en el navegador de Topo y reintenta.'
        )
      }
      await onBatch(batch)
    }
  }

  async generateReferrals(urls: readonly string[]): Promise<ReferralResult[]> {
    const pageId = await this.openLinkBuilder()
    const results: ReferralResult[] = []
    for (let index = 0; index < urls.length; index += LINKBUILDER_BATCH) {
      const batch = urls.slice(index, index + LINKBUILDER_BATCH)
      const answer = await this.evaluate(pageId, generateLinksExpression(batch))
      const failure = text(field(answer, 'error'))
      if (failure) {
        throw new Error(failure)
      }
      const lines = field(answer, 'lines')
      batch.forEach((url, position) => {
        const line = (Array.isArray(lines) ? text(lines[position]) : null)?.trim() ?? ''
        const isReferral = line.startsWith('https://meli.la/')
        results.push({
          url,
          referral: isReferral ? line : null,
          reason: isReferral
            ? null
            : line.replace(/^⚠️\s*/, '') || 'MercadoLibre no devolvió respuesta'
        })
      })
    }
    return results
  }

  async canonicalUrl(
    url: string
  ): Promise<{ status: number; canonical: string | null; unavailable: boolean }> {
    const pageId = await this.openMeliPage()
    const page = await this.evaluate(pageId, canonicalUrlExpression(url))
    return {
      status: amount(field(page, 'status')) ?? 0,
      canonical: text(field(page, 'canonical')),
      unavailable: field(page, 'unavailable') === true
    }
  }

  /** The first results MercadoLibre's own search shows for a product name. */
  async search(query: string): Promise<SearchResult[]> {
    const tab = await this.findTab()
    await this.run(['goto', '--page', tab.browserPageId, '--url', searchUrl(query)], 45_000)
    await this.run(['wait', '--page', tab.browserPageId, '--selector', '.poly-card'], 20_000).catch(
      () => undefined
    )
    const found = await this.evaluate(tab.browserPageId, SEARCH_RESULTS_EXPRESSION)
    return records(found).flatMap((result) => {
      const url = text(result.url)
      const title = text(result.title)
      return url && title
        ? [
            {
              url,
              title,
              price: amount(result.price),
              seller: text(result.seller),
              imageUrl: text(result.imageUrl)
            }
          ]
        : []
    })
  }
}
