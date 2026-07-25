import { memo } from 'react';
import type { ProsodyDiagnostics } from '../../types/audio';

interface Props {
  prosody: ProsodyDiagnostics;
}

function propsEqual(previous: Props, next: Props): boolean {
  const a = previous.prosody;
  const b = next.prosody;
  return (
    a.pace === b.pace &&
    a.energy === b.energy &&
    a.fluency === b.fluency &&
    a.lexicalDensity === b.lexicalDensity
  );
}

export const ProsodyPanel = memo(function ProsodyPanel({ prosody }: Props) {
  const metrics = [
    ['Pace', prosody.pace ? `${prosody.pace} wpm` : 'Learning'],
    ['Energy', prosody.energy ? `${Math.round(prosody.energy * 100)}%` : '—'],
    ['Fluency', `${Math.round(prosody.fluency * 100)}%`],
    ['Lexical density', prosody.lexicalDensity
      ? `${Math.round(prosody.lexicalDensity * 100)}%`
      : '—'],
  ];

  return (
    <div className="prosody-summary">
      <p>
        Derived locally from this recording. These descriptors are writing
        context, not an identity or authentication score.
      </p>
      <dl>
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}, propsEqual);
