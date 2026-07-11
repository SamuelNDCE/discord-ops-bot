const sharp = require('sharp');

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const WATERMARK_TEXT = process.env.WATERMARK_TEXT || 'BUSINESS1.EXAMPLE.COM';

function watermarkSvg(width, height, text) {
  const pad = Math.round(width * 0.03);
  const fontSize = Math.round(width * 0.032);
  const boxW = text.length * fontSize * 0.62 + pad * 1.6;
  const boxH = fontSize * 1.9;
  const x = width - boxW - pad;
  const y = height - boxH - pad;
  return Buffer.from(`
    <svg width="${width}" height="${height}">
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${boxH / 2}" fill="black" fill-opacity="0.45"/>
      <text x="${x + boxW / 2}" y="${y + boxH / 2 + fontSize * 0.35}" font-family="Arial, sans-serif" font-size="${fontSize}"
            font-weight="700" letter-spacing="1" fill="white" text-anchor="middle">${text}</text>
    </svg>
  `);
}

// Bottom-right corner badge, deliberately small/subtle — a logo-first frame is a documented
// scroll-stopping killer, so the mark must never compete with the actual hook.
async function watermarkImage(imageUrl, text = WATERMARK_TEXT) {
  const res = await fetch(imageUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buffer).metadata();
  return sharp(buffer)
    .composite([{ input: watermarkSvg(meta.width, meta.height, text), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// Uploads directly to Meta's ad image library (not a public URL) — returns an image_hash to use
// in object_story_spec.link_data.image_hash. Avoids depending on the AI-gen host's CDN staying up.
async function uploadImageToMeta(imageBuffer) {
  const { FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID } = process.env;
  const form = new FormData();
  form.append('access_token', FB_ACCESS_TOKEN);
  form.append('bytes', imageBuffer.toString('base64'));

  const res = await fetch(`${GRAPH_API}/${FB_AD_ACCOUNT_ID}/adimages`, { method: 'POST', body: form });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return Object.values(body.images)[0].hash;
}

async function watermarkAndUploadImage(imageUrl, text = WATERMARK_TEXT) {
  const watermarked = await watermarkImage(imageUrl, text);
  return uploadImageToMeta(watermarked);
}

function headlineBarSvg(width, height, headline) {
  const barH = Math.round(height * 0.1);
  const fontSize = Math.round(width * 0.052);
  return `
    <rect x="0" y="0" width="${width}" height="${barH}" fill="black" fill-opacity="0.55"/>
    <text x="${width / 2}" y="${barH / 2 + fontSize * 0.35}" font-family="Arial, sans-serif" font-size="${fontSize}"
          font-weight="800" letter-spacing="0.5" fill="white" text-anchor="middle">${headline}</text>
  `;
}

// Small pills stacked top-left, opposite the bottom-right watermark, for factual callouts (what's
// in the box, not vague hype) — e.g. "Catnip Included". Only use claims already verified against
// the live product listing; never write copy here that isn't checked first.
function badgeSvg(width, badgeY, text) {
  const pad = Math.round(width * 0.03);
  const fontSize = Math.round(width * 0.028);
  const boxW = text.length * fontSize * 0.6 + pad * 1.6;
  const boxH = fontSize * 1.8;
  return { svg: `
    <rect x="${pad}" y="${badgeY}" width="${boxW}" height="${boxH}" rx="${boxH / 2}" fill="#1b6e3c" fill-opacity="0.9"/>
    <text x="${pad + boxW / 2}" y="${badgeY + boxH / 2 + fontSize * 0.35}" font-family="Arial, sans-serif" font-size="${fontSize}"
          font-weight="700" fill="white" text-anchor="middle">${text}</text>
  `, height: boxH };
}

// Adds a top headline bar + stacked fact-badges (top-left) + the brand watermark (bottom-right)
// in one pass. `badges` should only contain claims already verified against the live product
// listing — this exists specifically so ad copy can't silently drift from what's actually true.
async function addClarityOverlays(imageUrl, { headline, badges = [], watermarkText = WATERMARK_TEXT } = {}) {
  const res = await fetch(imageUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buffer).metadata();
  const { width, height } = meta;

  const parts = [];
  if (headline) parts.push(headlineBarSvg(width, height, headline));

  const barH = Math.round(height * 0.1);
  const pad = Math.round(width * 0.03);
  let y = headline ? barH + pad : pad;
  for (const badgeText of badges) {
    const { svg, height: boxH } = badgeSvg(width, y, badgeText);
    parts.push(svg);
    y += boxH + pad * 0.6;
  }

  parts.push(watermarkSvg(width, height, watermarkText).toString().replace(/<\/?svg[^>]*>/g, ''));

  const overlaySvg = Buffer.from(`<svg width="${width}" height="${height}">${parts.join('')}</svg>`);
  return sharp(buffer).composite([{ input: overlaySvg, top: 0, left: 0 }]).png().toBuffer();
}

async function addClarityOverlaysAndUpload(imageUrl, opts) {
  const composited = await addClarityOverlays(imageUrl, opts);
  return uploadImageToMeta(composited);
}

module.exports = {
  watermarkImage,
  uploadImageToMeta,
  watermarkAndUploadImage,
  addClarityOverlays,
  addClarityOverlaysAndUpload,
};
