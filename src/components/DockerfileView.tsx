import '../styles/dockerfile.css';

export default function DockerfileView({ source }: { source: string }) {
  if (!source.trim()) return <div className="empty"><p className="empty-title">Dein eigenes Container-Image</p><p>Dockerfile-Start und FROM verbinden, dann Build-Schritte und Startbefehl ergänzen. Die Dockerfile erscheint hier live.</p></div>;
  return <pre className="yaml-code dockerfile-code" aria-label="Dockerfile-Vorschau">{source.replace(/\n$/,'').split('\n').map((line,index) => {
    const instruction = line.match(/^([A-Z]+)(\s.*)?$/);
    return <span className="dockerfile-line" key={index}><span className="y-ln">{index+1}</span>{line.startsWith('#') ? <span className="y-comment">{line}</span> : instruction ? <><span className="y-key">{instruction[1]}</span><span className="y-str">{instruction[2]}</span></> : line}{'\n'}</span>;
  })}</pre>;
}
