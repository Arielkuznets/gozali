// What the widgets read when they refresh on their own (spec section 9). The widget sends the
// token the app stored for it in x-widget-token.
//   GET /widget-state                       -> the packs, as JSON
//   GET /widget-state?image=<pack>&night=1  -> that pack's critter as a PNG
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';

import { artSvg, artVersion, dayIn, widgetPack, type WidgetPackRow } from './state.ts';

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
  const day = dayIn(state.timezone, new Date());
  const packs = state.packs.map((row) => widgetPack(row, day));
  const url = new URL(request.url);
  const imageFor = url.searchParams.get('image');

  if (imageFor) {
    const pack = packs.find((candidate) => candidate.id === imageFor);
    if (!pack) return new Response('not found', { status: 404 });
    // 64 to 600 pixels; a missing or broken size gets the default.
    const asked = Number(url.searchParams.get('size'));
    const size = Number.isFinite(asked) && asked > 0 ? Math.min(600, Math.max(64, asked)) : 300;
    // Loaded once per instance; a failed load is forgotten so the next request tries again.
    resvgReady ??= initWasm(fetch(RESVG_WASM)).catch((error) => {
      resvgReady = null;
      throw error;
    });
    await resvgReady;
    const art = url.searchParams.get('night') === '1' ? pack.nightArt : pack.art;
    return new Response(png(artSvg(art), size), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' },
    });
  }

  return Response.json({
    timezone: state.timezone,
    fetchedAt: new Date().toISOString(),
    // The drawing input goes along too: the Android widget draws it as SVG on the device.
    packs: packs.map((pack) => ({
      ...pack,
      // Relative to this endpoint, which the widget already knows; the version lets it cache by URL.
      imageUrl: `?image=${pack.id}&v=${artVersion(pack.art)}`,
      nightImageUrl: `?image=${pack.id}&night=1&v=${artVersion(pack.nightArt)}`,
    })),
  });
});
