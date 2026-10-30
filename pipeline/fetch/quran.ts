// Koran: Vers (Uthmani + Bubenheim/Elyas) und Tafsir (al-Muyassar arabisch, Ibn Kathir englisch), fortlaufend ab 1:1.
import { getJson, sleep } from '../http';
import type { RawRecord } from '../raw';
import type { FetchContext } from './context';

// quran.com v4 zuerst, dann die v4-kompatible CDN-API von quran.com, dann islamic.app
export const BASES = ['https://api.quran.com/api/v4', 'https://api.qurancdn.com/api/qdc', 'https://api.islamic.app/v4'];

// Bekannte IDs als Fallback, falls die Ressourcen-Listen nicht auflösbar sind
const FALLBACK = { translation: 27, muyassar: 16, ibnKathir: 169 };

interface Resource { id: number; name?: string; author_name?: string; language_name?: string; slug?: string }
interface Chapter { id: number; name_simple: string; verses_count: number; translated_name?: { name?: string } }
interface VerseResponse { verse?: { verse_key: string; text_uthmani?: string; translations?: { resource_id: number; text: string }[] } }
interface TafsirResponse { tafsir?: { text?: string; resource_name?: string } }

async function pickBase(): Promise<string | null> {
  for (const b of BASES) {
    const r = await getJson<{ chapters?: Chapter[] }>(`${b}/chapters?language=de`);
    if (r.status === 200 && r.data?.chapters?.length) return b;
    console.warn(`  quran: ${b} nicht nutzbar (HTTP ${r.status})`);
  }
  return null;
}

async function resolveIds(base: string) {
  const ids = { ...FALLBACK };
  const tr = await getJson<{ translations?: Resource[] }>(`${base}/resources/translations`);
  const bub = tr.data?.translations?.find((t) => /bubenheim/i.test(`${t.name} ${t.author_name}`));
  if (bub) ids.translation = bub.id;
  const tf = await getJson<{ tafsirs?: Resource[] }>(`${base}/resources/tafsirs`);
  const list = tf.data?.tafsirs ?? [];
  const muy = list.find((t) => /muyassar|ميسر/i.test(`${t.name} ${t.slug}`));
  if (muy) ids.muyassar = muy.id;
  const ik = list.find((t) => /kathir/i.test(`${t.name} ${t.author_name} ${t.slug}`) && /english/i.test(t.language_name ?? ''));
  if (ik) ids.ibnKathir = ik.id;
  console.log(`  quran: Übersetzung ${ids.translation}, al-Muyassar ${ids.muyassar}, Ibn Kathir ${ids.ibnKathir}`);
  return ids;
}

export async function fetchQuran(ctx: FetchContext): Promise<RawRecord[]> {
  const now = new Date().toISOString();
  const base = await pickBase();
  if (!base) return [];
  const chapters = (await getJson<{ chapters?: Chapter[] }>(`${base}/chapters?language=de`)).data?.chapters ?? [];
  const ids = await resolveIds(base);
  const count = ctx.seed ? 66 : 2;
  const out: RawRecord[] = [];
  let { surah, ayah } = ctx.state.quran;

  for (let i = 0; i < count; i++) {
    const ch = chapters.find((c) => c.id === surah);
    if (!ch) break;
    const key = `${surah}:${ayah}`;
    const vUrl = `${base}/verses/by_key/${key}?translations=${ids.translation}&fields=text_uthmani`;
    const v = await getJson<VerseResponse>(vUrl);
    const muy = await getJson<TafsirResponse>(`${base}/tafsirs/${ids.muyassar}/by_ayah/${key}`);
    const ik = await getJson<TafsirResponse>(`${base}/tafsirs/${ids.ibnKathir}/by_ayah/${key}`);
    const translation = v.data?.verse?.translations?.[0]?.text ?? '';
    const status = [v.status, muy.status, ik.status].every((s) => s === 200) ? 200 : Math.max(v.status, muy.status, ik.status);
    console.log(`  quran ${key}: Vers ${v.status}, Muyassar ${muy.status}, Ibn Kathir ${ik.status}`);
    if (!ctx.known.has(`quran:${key}`)) {
      out.push({
        sourceId: `quran:${key}`,
        source: 'quran',
        area: 'beat',
        topic: 'koran',
        url: `https://quran.com/${surah}/${ayah}`,
        urlStatus: 0,
        api: { url: vUrl, status },
        title: `${ch.name_simple} ${key}`,
        publisher: 'Quran.com',
        content: {
          arabic: v.data?.verse?.text_uthmani ?? '',
          translation,
          tafsir_muyassar: muy.data?.tafsir?.text ?? '',
          tafsir_ibnkathir: ik.data?.tafsir?.text ?? '',
        },
        meta: { kind: 'verse', surahName: ch.name_simple, surahNameDe: ch.translated_name?.name, key },
        fetchedAt: now,
      });
    }
    ayah++;
    if (ayah > ch.verses_count) {
      surah = surah >= 114 ? 1 : surah + 1;
      ayah = 1;
    }
    await sleep(300);
  }
  ctx.state.quran = { surah, ayah };
  return out;
}
