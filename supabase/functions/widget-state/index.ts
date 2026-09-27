// What the widgets read when they refresh on their own (spec section 9). The widget sends the
// token the app stored for it in x-widget-token.
//   GET /widget-state                       -> the packs, as JSON
//   GET /widget-state?image=<pack>&night=1  -> that pack's critter as a PNG
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';

import { artSvg, artVersion, widgetPack, type WidgetPackRow } from './state.ts';

const RESVG_WASM = 'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
let resvgReady: Promise<void> | null = null;

function png(svg: string, size: number): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

Deno.serve(async (request) => {
  const token = request.headers.get('x-widget-token');
  if (!token) return new Response('missing token', { status: 401 });

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc('widget_state', { token });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (data === null) return new Response('unknown token', { status: 401 });

  const state = data as { timezone: string; packs: WidgetPackRow[] };
  const packs = state.packs.map(widgetPack);
  const url = new URL(request.url);
  const imageFor = url.searchParams.get('image');

  if (imageFor) {
    const pack = packs.find((candidate) => candidate.id === imageFor);
    if (!pack) return new Response('not found', { status: 404 });
    const size = Math.min(600, Math.max(64, Number(url.searchParams.get('size') ?? 300)));
    resvgReady ??= initWasm(fetch(RESVG_WASM));
    await resvgReady;
    const art = url.searchParams.get('night') === '1' ? pack.nightArt : pack.art;
    return new Response(png(artSvg(art), size), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' },
    });
  }

  return Response.json({
    timezone: state.timezone,
    fetchedAt: new Date().toISOString(),
    packs: packs.map(({ art, nightArt, ...pack }) => ({
      ...pack,
      // Relative to this endpoint, which the widget already knows; the version lets it cache by URL.
      imageUrl: `?image=${pack.id}&v=${artVersion(art)}`,
      nightImageUrl: `?image=${pack.id}&night=1&v=${artVersion(nightArt)}`,
    })),
  });
});
