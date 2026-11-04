import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const blocks: { c: string; t: string; d: number; hat?: boolean }[] = [
  { c: '#c08a1e', t: 'Deployment  web  Replicas  ${REPLICAS}', d: 0, hat: true },
  { c: '#c9702a', t: 'Container  web  Image  registry/web:1.0', d: 0 },
  { c: '#2b8fa8', t: 'Port  8080  Name  http', d: 1 },
  { c: '#2b8fa8', t: 'mindestens (requests)  CPU 100m  RAM 128Mi', d: 1 },
  { c: '#2b8fa8', t: 'Bereit? (readiness)  HTTP GET  /ready', d: 1 },
  { c: '#c9702a', t: 'Image Pull Secret  registry-credentials', d: 0 },
];

const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    spec:
      containers:
        - name: web
          image: registry/web:1.0
          ports:
            - name: http
              containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080`;

const facts: [string, string][] = [
  ['106 Blöcke', 'Compose-Services, Deployments, Routes, BuildConfigs, HPAs und mehr. Mit Extras-Blöcken lässt sich jedes weitere Feld setzen.'],
  ['Import ohne Verlust', 'Bestehendes YAML oder die Ausgabe von oc get -o yaml wird zu Blöcken. Unbekannte Felder werden zu Extras.'],
  ['Variablen pro Umgebung', '${REPLICAS} ist in dev 1 und in prod 3. Gleiche Blöcke, unterschiedliche Manifeste.'],
  ['Offline & lokal', 'Desktop-App für Windows. Projekte speichert sie automatisch in SQLite unter %APPDATA%, ohne Server.'],
  ['43 Vorlagen', 'Kleine Block-Kombinationen wie PostgreSQL mit Healthcheck, Probes-Set oder gehärteter Container.'],
  ['.byob-Dateien', 'Projekte und Vorlagen als eine Datei teilen, sichern und wieder einspielen.'],
];

export default function Home() {
  return (
    <Layout title="Start" description="BYOBYaml – Docker Compose, Kubernetes und OpenShift aus Blöcken bauen">
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Desktop-App · Windows · Offline</p>
            <h1>Manifeste aus Blöcken bauen.</h1>
            <p className={styles.lead}>
              BYOBYaml ist ein Block-Editor für <b>Docker Compose</b>, <b>Kubernetes</b> und <b>OpenShift</b>. Du steckst Blöcke zusammen und siehst das
              gültige YAML live daneben. Bestehende Dateien importierst du zurück in Blöcke.
            </p>
            <div className={styles.cta}>
              <Link className="button button--primary button--lg" to="/docs/erste-schritte">
                Erste Schritte
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/referenz">
                Block-Referenz
              </Link>
            </div>
          </div>

          <div className={styles.demo} aria-hidden>
            <div className={styles.canvas}>
              {blocks.map((b, i) => (
                <div key={i} className={`${styles.block} ${b.hat ? styles.hat : ''}`} style={{ background: b.c, marginLeft: b.d * 18 }}>
                  {b.t}
                </div>
              ))}
            </div>
            <pre className={styles.yaml}>{yaml}</pre>
          </div>
        </section>

        <section className={styles.facts}>
          {facts.map(([t, d]) => (
            <div key={t}>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </section>
      </main>
    </Layout>
  );
}
