import { useMemo } from 'react';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlightValue(v: string): string {
  const t = v.trim();
  if (!t) return esc(v);
  if (/^(true|false|null|~)$/.test(t)) return `<span class="y-bool">${esc(v)}</span>`;
  if (/^-?\d+(\.\d+)?$/.test(t)) return `<span class="y-num">${esc(v)}</span>`;
  if (/^[>|][-+]?$/.test(t)) return `<span class="y-punct">${esc(v)}</span>`;
  return `<span class="y-str">${esc(v)}</span>`;
}

function highlightLine(line: string): string {
  if (line === '---') return '<span class="y-sep">---</span>';
  if (/^\s*#/.test(line)) return `<span class="y-comment">${esc(line)}</span>`;
  const m = line.match(/^(\s*)(- )?((?:"[^"]*"|'[^']*'|[^\s:"'][^:]*?)):(\s|$)(.*)$/);
  if (m) {
    const [, ind, dash = '', key, sp, rest] = m;
    return `${ind}${dash ? '<span class="y-punct">- </span>' : ''}<span class="y-key">${esc(key)}</span><span class="y-punct">:</span>${sp}${highlightValue(rest)}`;
  }
  const d = line.match(/^(\s*)- (.*)$/);
  if (d) return `${d[1]}<span class="y-punct">- </span>${highlightValue(d[2])}`;
  return highlightValue(line);
}

export default function YamlView({ yaml }: { yaml: string }) {
  const html = useMemo(() => {
    const lines = yaml.replace(/\n$/, '').split('\n');
    return lines.map((l, i) => `<span class="y-ln">${i + 1}</span>${highlightLine(l)}`).join('\n');
  }, [yaml]);
  if (!yaml.trim()) {
    return (
      <div className="empty">
        <p className="empty-title">Noch kein Output</p>
        <p>Zieh einen Startblock (Compose-Datei oder eine Ressource) auf die Fläche oder nimm eine Vorlage. Das YAML erscheint hier live.</p>
      </div>
    );
  }
  return <pre className="yaml-code" dangerouslySetInnerHTML={{ __html: html }} />;
}
