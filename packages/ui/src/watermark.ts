/**
 * The #BuiltWithPeec watermark text/links are centralised here so we never
 * accidentally drift the public-facing text across the OG image, share page,
 * and the LinkedIn/X share intent.
 */
export const WATERMARK_TEXT = '#BuiltWithPeec';
export const WATERMARK_HREF = 'https://peec.ai/mcp-challenge';
export const SHARE_INTENT_TEMPLATE = (url: string, verdictLine: string) =>
  `${verdictLine}\n\n${url}\n\n${WATERMARK_TEXT}`;
