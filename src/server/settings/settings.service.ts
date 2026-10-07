import type { SiteSettings, SiteSettingsInput } from '../../shared/models';
import { type Database, nowIso, sql } from '../db/database';
import { parseBody } from '../http/validation';
import type { MediaService } from '../media/media.service';
import { DEFAULT_SETTINGS, settingsSchema } from './settings.schema';

/** Configurações do site (linha única, documento JSON). Fonte de todos os dados do cliente. */
export class SettingsService {
  constructor(
    private readonly db: Database,
    private readonly media: MediaService,
  ) {}

  private async readInput(): Promise<{ input: SiteSettingsInput; updatedAt: string }> {
    const row = await this.db.first(sql('SELECT data, updated_at FROM settings WHERE id = 1'));
    if (!row) return { input: DEFAULT_SETTINGS, updatedAt: nowIso() };
    // Mescla com os padrões para tolerar campos novos de versões futuras.
    const stored = JSON.parse(String(row['data'])) as Partial<SiteSettingsInput>;
    return { input: { ...DEFAULT_SETTINGS, ...stored }, updatedAt: String(row['updated_at']) };
  }

  async get(): Promise<SiteSettings> {
    const { input, updatedAt } = await this.readInput();
    const ids = [input.logoId, input.heroImageId, input.aboutImageId].filter(
      (id): id is string => !!id,
    );
    const images = await this.media.findMany(ids);
    const image = (id: string | null) => (id ? (images.get(id) ?? null) : null);
    return {
      ...input,
      logo: image(input.logoId),
      heroImage: image(input.heroImageId),
      aboutImage: image(input.aboutImageId),
      updatedAt,
    };
  }

  async update(body: unknown): Promise<SiteSettings> {
    const input = parseBody(settingsSchema, body);
    await this.media.assertExist([input.logoId, input.heroImageId, input.aboutImageId]);
    const previous = (await this.readInput()).input;
    await this.db.run(
      sql(
        `INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        JSON.stringify(input),
        nowIso(),
      ),
    );
    await this.media.deleteIfUnused([previous.logoId, previous.heroImageId, previous.aboutImageId]);
    return this.get();
  }
}
