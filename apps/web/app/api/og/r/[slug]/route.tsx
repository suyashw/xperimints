import { ImageResponse } from 'next/og';
import { getExperimentByShareSlug } from '@/lib/data';
import { WATERMARK_TEXT, formatPpDelta } from '@peec-lab/ui';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const exp = await getExperimentByShareSlug(slug);
  const verdict = exp?.result?.verdict ?? 'PENDING';
  const lifts = (exp?.result?.liftByEngine ?? {}) as Record<
    string,
    { lift_pp: number; p_value_corrected?: number }
  >;
  const best = Object.entries(lifts)
    .filter(([, l]) => (l.p_value_corrected ?? 1) < 0.05)
    .sort(([, a], [, b]) => b.lift_pp - a.lift_pp)[0];

  const verdictColor =
    verdict === 'WIN' ? '#16a34a' : verdict === 'LOSS' ? '#dc2626' : '#6b7280';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          background: '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          padding: 64,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            color: '#737373',
            textTransform: 'uppercase',
            letterSpacing: 2,
          }}
        >
          Peec Experiment Lab
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 32,
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.1,
            color: '#171717',
            maxWidth: 1000,
          }}
        >
          {exp?.name ?? 'Experiment not found'}
        </div>
        {best && (
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 24,
              marginTop: 40,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 28,
                color: '#fff',
                background: verdictColor,
                padding: '8px 20px',
                borderRadius: 12,
              }}
            >
              {verdict}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 96,
                fontWeight: 800,
                color: verdictColor,
              }}
            >
              {formatPpDelta(best[1].lift_pp / 100, 1)}
            </div>
            <div style={{ display: 'flex', fontSize: 32, color: '#737373' }}>
              on {best[0]}
            </div>
          </div>
        )}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', fontSize: 24, color: '#737373' }}>
            {exp?.treatmentUrl ?? ''}
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#0ea5e9' }}>
            {WATERMARK_TEXT}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
