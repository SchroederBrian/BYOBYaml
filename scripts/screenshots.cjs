// Drives the real Electron app and captures the screenshots used in the docs (docs-site/static/img/screens).
// Started by scripts/run-screenshots.cjs with a throw-away data directory.
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'docs-site', 'static', 'img', 'screens');

// ---------- block state builder (same shape as src/project.ts) ----------
const b = (type, fields = {}, body) => ({ type, fields, body });
function chain(blocks) {
  if (!blocks.length) return undefined;
  const [first, ...rest] = blocks;
  const j = { type: first.type, fields: first.fields };
  if (first.body && first.body.length) j.inputs = { BODY: { block: chain(first.body) } };
  const next = chain(rest);
  if (next) j.next = { block: next };
  return j;
}
const ws = (...stacks) => ({ blocks: { languageVersion: 0, blocks: stacks.map((s, i) => ({ ...chain(s), x: 0, y: i * 330 })) } });

// ---------- helpers injected into the page ----------
const PAGE_HELPERS = `
window.__h = {
  q: (s) => document.querySelector(s),
  byText(sel, text) { return [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text)); },
  click(sel, text) { const el = text ? this.byText(sel, text) : this.q(sel); if (!el) throw new Error('not found: ' + sel + ' ' + (text || '')); el.click(); },
  setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  },
  rect(sel) { const r = (typeof sel === 'string' ? this.q(sel) : sel).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; },
  closeMenus() { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); },
  esc() { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); },
  category(name) {
    const tb = __byob.ws.getToolbox();
    if (!name) return tb.clearSelection();
    const it = tb.getToolboxItems().find((i) => i.getName && i.getName() === name);
    tb.setSelectedItem(it);
  },
  load(state) {
    this.category(null);
    __byob.Blockly.serialization.workspaces.load(state, __byob.ws);
    this.home();
  },
  home() {
    const w = __byob.ws;
    const first = w.getTopBlocks(true)[0];
    if (!first) return;
    const host = document.querySelector('.block-host').getBoundingClientRect();
    const tb = document.querySelector('.blocklyToolbox').getBoundingClientRect();
    const r = first.getSvgRoot().getBoundingClientRect();
    w.scroll(w.scrollX + tb.right + 36 - r.left, w.scrollY + host.top + 28 - r.top);
  },
  marker(n, x, y) {
    const m = document.createElement('div');
    m.className = '__mark';
    m.textContent = n;
    Object.assign(m.style, { position: 'fixed', left: x - 13 + 'px', top: y - 13 + 'px', width: '26px', height: '26px', borderRadius: '50%',
      background: '#ffcc4d', color: '#111', font: '700 14px IBM Plex Sans, sans-serif', display: 'grid', placeItems: 'center', zIndex: 9999,
      boxShadow: '0 0 0 3px rgba(0,0,0,.55)' });
    document.body.appendChild(m);
  },
  clearMarkers() { document.querySelectorAll('.__mark').forEach((m) => m.remove()); },
};
true;`;

module.exports = async function run(win, app) {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const step = (name) => console.log('[screens]', name);

  async function shot(name, area, pad = 0) {
    await wait(450);
    let rect;
    if (typeof area === 'string') rect = await js(`return __h.rect(${JSON.stringify(area)})`);
    else if (typeof area === 'function') rect = await js(`return (${area.toString()})()`);
    else rect = area;
    if (rect) {
      rect = {
        x: Math.max(0, Math.round(rect.x - pad)),
        y: Math.max(0, Math.round(rect.y - pad)),
        width: Math.round(rect.width + pad * 2),
        height: Math.round(rect.height + pad * 2),
      };
    }
    const img = await wc.capturePage(rect || undefined);
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
    step(`saved ${name}.png`);
  }

  // area helpers (evaluated in the page)
  const WORKBENCH = () => {
    const c = __h.rect('.canvas');
    const i = __h.rect('.inspector');
    return { x: c.x, y: c.y, width: i.right - c.x, height: Math.min(c.height, 470) };
  };
  const CANVAS_TOP = () => {
    const c = __h.rect('.canvas');
    return { x: c.x, y: c.y, width: c.width, height: Math.min(c.height, 520) };
  };
  const INSPECTOR_TOP = () => {
    const i = __h.rect('.inspector');
    return { x: i.x, y: i.y, width: i.width, height: Math.min(i.height, 470) };
  };

  try {
    fs.mkdirSync(OUT, { recursive: true });
    win.setContentSize(1440, 860);
    if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
    await js(PAGE_HELPERS);
    // wait for the seeded OpenShift demo project
    for (let i = 0; i < 50; i++) {
      if (await js(`return document.querySelectorAll('.file-list li').length > 3 && !!window.__byob`)) break;
      await wait(200);
    }
    await wait(1200);

    // ---------- 1. overview with markers ----------
    step('overview');
    await js(`__h.click('.file-list li', '04-deployment')`);
    await wait(900);
    await js(`
      const at = (sel, dx = 0.5, dy = 0.5) => { const r = __h.rect(sel); return [r.x + r.width * dx, r.y + r.height * dy]; };
      const right = (sel, dx) => { const r = __h.rect(sel); return [r.right + dx, r.y + r.height / 2]; };
      const left = (sel, dx) => { const r = __h.rect(sel); return [r.x - dx, r.y + r.height / 2]; };
      __h.marker(1, ...right('.menus', 20));
      __h.marker(2, ...left('.title-center', 20));
      __h.marker(3, ...left('.env-select', 20));
      __h.marker(4, ...at('.explorer', 0.88, 0.05));
      __h.marker(5, ...at('.blocklyToolbox', 0.85, 0.25));
      __h.marker(6, ...at('.block-host', 0.75, 0.55));
      __h.marker(7, ...at('.tabs', 0.92, 0.5));
      __h.marker(8, ...at('.yaml-scroll', 0.8, 0.3));
      __h.marker(9, ...at('.statusbar', 0.5, 0.5));
    `);
    await shot('uebersicht');
    await js(`__h.clearMarkers()`);

    // ---------- 2. explorer + menus ----------
    step('explorer');
    await shot('dateien', () => {
      const r = __h.rect('.explorer');
      return { x: r.x, y: r.y, width: r.width, height: 300 };
    });
    for (const [menu, name] of [
      ['Datei', 'menue-datei'],
      ['Importieren', 'menue-import'],
      ['Exportieren', 'menue-export'],
    ]) {
      await js(`__h.click('.menu-btn', ${JSON.stringify(menu)})`);
      await shot(name, () => {
        const d = __h.rect('.dropdown');
        return { x: d.x - 8, y: 0, width: d.width + 16, height: d.bottom + 8 };
      });
      await js(`__h.closeMenus()`);
    }

    // ---------- 3. palette ----------
    step('palette');
    await js(`__h.category('Container')`);
    await shot('palette-container', CANVAS_TOP);
    await js(`__h.category('Vorlagen')`);
    await shot('palette-vorlagen', CANVAS_TOP);
    await js(`__h.category(null)`);

    // ---------- 4. step by step: new Kubernetes file ----------
    step('steps');
    await js(`__h.click('.pane-actions .icon-btn[title="Neue Kubernetes-Datei"]')`);
    await wait(900);
    const dep = (children) => [b('k8s_deployment', { NAME: 'web', REPLICAS: '2' }), ...children];
    const container = (inner) => b('pod_container', { NAME: 'web', IMAGE: 'nginx:1.27' }, inner);
    const steps = [
      ['schritt-1', ws(dep([]))],
      ['schritt-2', ws(dep([container([])]))],
      ['schritt-3', ws(dep([container([b('c_port', { PORT: '8080', NAME: 'http', PROTO: 'TCP' }), b('c_resources', { KIND: 'requests', CPU: '100m', MEM: '128Mi' })])]))],
      [
        'schritt-4',
        ws(
          dep([
            container([
              b('c_port', { PORT: '8080', NAME: 'http', PROTO: 'TCP' }),
              b('c_resources', { KIND: 'requests', CPU: '100m', MEM: '128Mi' }),
              b('c_probe', { KIND: 'readinessProbe', HOW: 'http', PATH: '/ready', PORT: 'http', DELAY: '5', PERIOD: '10' }),
            ]),
          ]),
          [b('k8s_service', { NAME: 'web', APP: 'web', TYPE: 'ClusterIP' }), b('svc_k8s_port', { PORT: '80', TARGET: 'http', NAME: 'http', PROTO: 'TCP' })],
        ),
      ],
    ];
    for (const [name, state] of steps) {
      await js(`__h.load(${JSON.stringify(state)})`);
      await shot(name, WORKBENCH);
    }

    // ---------- 5. a problem ----------
    step('problems');
    await js(
      `__h.load(${JSON.stringify(
        ws([b('k8s_deployment', { NAME: 'web', REPLICAS: '2' }), b('c_port', { PORT: '8080', NAME: 'http', PROTO: 'TCP' }), container([b('c_env', { K: 'TZ', V: 'Europe/Berlin' })])]),
      )})`,
    );
    await wait(300);
    await js(`__h.click('.tab', 'Probleme')`);
    await shot('probleme', WORKBENCH);
    await js(`__h.click('.tab', 'YAML')`);

    // ---------- 6. variables & environments ----------
    step('variables');
    await js(`__h.click('.file-list li', '04-deployment')`);
    await wait(900);
    await js(`__h.click('.tab', 'Variablen')`);
    await shot('variablen', INSPECTOR_TOP);
    await js(`__h.click('.tab', 'YAML')`);
    await shot('umgebung-dev', WORKBENCH);
    await js(`__h.setVal(__h.q('.env-select select'), 'prod')`);
    await wait(500);
    await shot('umgebung-prod', WORKBENCH);
    await js(`__h.setVal(__h.q('.env-select select'), 'dev')`);

    // ---------- 7. import ----------
    step('import');
    await js(`__h.click('.explorer-foot button')`);
    await wait(300);
    const sample = fs.readFileSync(path.join(__dirname, 'samples', 'handbuch-import.yaml'), 'utf8');
    await js(`__h.setVal(__h.q('.modal textarea'), ${JSON.stringify(sample)}); __h.setVal(__h.q('.modal input'), 'shop-export.yaml')`);
    await shot('import-einfuegen', '.modal', 12);
    await js(`__h.click('.modal .btn.primary')`);
    await wait(900);
    await shot('import-bericht', '.modal', 12);
    await js(`__h.click('.modal .btn.primary')`);
    await wait(500);
    await js(`__h.home()`);
    await shot('import-ergebnis', () => {
      const c = __h.rect('.canvas');
      const i = __h.rect('.inspector');
      return { x: c.x, y: c.y, width: i.right - c.x, height: Math.min(c.height, 640) };
    });

    // ---------- 8. snippets ----------
    step('snippets');
    await js(`__h.click('.file-list li', 'resource.yaml')`);
    await wait(900);
    const snippetState = ws([
      b('k8s_deployment', { NAME: 'web', REPLICAS: '2' }),
      container([
        b('c_resources', { KIND: 'requests', CPU: '100m', MEM: '128Mi' }),
        b('c_resources', { KIND: 'limits', CPU: '500m', MEM: '512Mi' }),
        b('c_security', { NOESC: 'TRUE', ROFS: 'TRUE', DROP: 'TRUE' }),
      ]),
    ]);
    await js(`__h.load(${JSON.stringify(snippetState)})`);
    await wait(400);
    // open the real context menu on the container block
    await js(`
      const blk = __byob.ws.getAllBlocks(false).find((x) => x.type === 'pod_container');
      const r = blk.getSvgRoot().getBoundingClientRect();
      blk.showContextMenu(new PointerEvent('contextmenu', { clientX: r.x + 60, clientY: r.y + 12, bubbles: true }));
    `);
    await shot('kontextmenue', () => {
      const m = document.querySelector('.blocklyWidgetDiv .blocklyMenu') || document.querySelector('.blocklyContextMenu');
      const c = __h.rect('.canvas');
      const r = m ? m.getBoundingClientRect() : { right: c.x + 600, bottom: c.y + 400 };
      return { x: c.x, y: c.y, width: Math.max(r.right - c.x + 20, 560), height: r.bottom - c.y + 16 };
    });
    await js(`
      __byob.Blockly.ContextMenu.hide();
      const blk = __byob.ws.getAllBlocks(false).find((x) => x.type === 'pod_container');
      __byob.Blockly.ContextMenuRegistry.registry.getItem('byob_save_snippet').callback({ block: blk });
    `);
    await wait(400);
    await js(`__h.setVal(__h.q('.modal input'), 'Container: sicher & begrenzt')`);
    await shot('vorlage-speichern', '.modal', 12);
    await js(`__h.click('.modal .btn.primary')`);
    await wait(700);
    await js(`__h.category('Meine Vorlagen')`);
    await shot('meine-vorlagen', CANVAS_TOP);
    await js(`__h.category(null)`);

    // ---------- 9. projects + compose ----------
    step('projects');
    await js(`__h.click('.project-switch')`);
    await wait(500);
    await shot('projekte', '.modal', 12);
    await js(`__h.click('.modal .link', 'Compose')`);
    await wait(1200);
    await js(`__h.home()`);
    await shot('compose', () => {
      const c = __h.rect('.canvas');
      const i = __h.rect('.inspector');
      return { x: c.x, y: c.y, width: i.right - c.x, height: Math.min(c.height, 600) };
    });

    // =====================================================================
    // Scenes for the concept / function / guide pages
    // =====================================================================
    const at = (blocks, x, y) => ({ ...chain(blocks), x, y });
    const loadAt = async (...stacks) => js(`__h.load(${JSON.stringify({ blocks: { languageVersion: 0, blocks: stacks } })})`);

    // ---------- 10. Compose project (currently open) ----------
    step('compose scenes');
    await shot('toolbox-compose', () => {
      const r = __h.rect('.blocklyToolbox');
      return { x: r.x, y: r.y, width: r.width, height: 330 };
    });
    await js(`__h.category('Vorlagen')`);
    await shot('palette-vorlagen-compose', CANVAS_TOP);
    await js(`__h.category(null)`);
    await shot('statusleiste', () => {
      const r = __h.rect('.statusbar');
      return { x: r.x, y: r.y - 1, width: r.width, height: r.height + 1 };
    });
    await js(`
      const c = __h.rect('.block-host');
      __byob.ws.showContextMenu(new PointerEvent('contextmenu', { clientX: c.x + c.width * 0.55, clientY: c.y + c.height * 0.55, bubbles: true }));
    `);
    await shot('kontextmenue-flaeche', () => {
      const m = document.querySelector('.blocklyWidgetDiv .blocklyMenu');
      const r = m.getBoundingClientRect();
      return { x: r.x - 40, y: r.y - 40, width: r.width + 80, height: r.height + 80 };
    });
    await js(`__byob.Blockly.ContextMenu.hide()`);

    // ---------- 11. new project: first steps with Compose ----------
    step('new project');
    await js(`__h.click('.menu-btn', 'Datei')`);
    await js(`__h.click('.dropdown button', 'Neues Projekt')`);
    await wait(1200);
    await js(`__h.home()`);
    await shot('compose-start-1', WORKBENCH);
    await loadAt(at([b('compose_file', { NAME: '' }), b('compose_service', { NAME: 'web', IMAGE: 'nginx:latest' }, [b('svc_port', { HOST: '8080', CONT: '80', PROTO: 'tcp' })])], 0, 0));
    await shot('compose-start-2', WORKBENCH);
    await loadAt(
      at(
        [
          b('compose_file', { NAME: '' }),
          b('compose_service', { NAME: 'web', IMAGE: 'nginx:latest' }, [b('svc_port', { HOST: '8080', CONT: '80', PROTO: 'tcp' }), b('svc_restart', { R: 'unless-stopped' })]),
        ],
        0,
        0,
      ),
    );
    await wait(300);
    await js(`
      const blk = __byob.ws.getAllBlocks(false).find((x) => x.type === 'svc_restart');
      blk.getField('R').showEditor();
    `);
    await shot('feld-auswahl', CANVAS_TOP);
    await js(`__byob.Blockly.DropDownDiv.hideWithoutAnimation(); __byob.Blockly.WidgetDiv.hide();`);

    // ---------- 12. Kubernetes file in the new project ----------
    step('k8s concept scenes');
    await js(`__h.click('.pane-actions .icon-btn[title="Neue Kubernetes-Datei"]')`);
    await wait(900);
    await shot('toolbox-k8s', () => {
      const r = __h.rect('.blocklyToolbox');
      return { x: r.x, y: r.y, width: r.width, height: 360 };
    });

    await loadAt(
      at([b('k8s_service', { NAME: 'web', APP: 'web', TYPE: 'ClusterIP' })], 0, 0),
      at([b('meta_label', { K: 'tier', V: 'frontend' })], 0, 110),
      at([b('pod_container', { NAME: 'web', IMAGE: 'nginx:1.27' }, [b('c_port', { PORT: '8080', NAME: 'http', PROTO: 'TCP' })])], 0, 200),
    );
    await shot('blockformen', () => {
      const c = __h.rect('.canvas');
      return { x: c.x, y: c.y + 36, width: c.width * 0.85, height: 330 };
    });

    await loadAt(
      at(
        [
          b('k8s_deployment', { NAME: 'web', REPLICAS: '2' }),
          b('meta_namespace', { NS: 'shop' }),
          b('pod_container', { NAME: 'web', IMAGE: 'registry.example.com/web:1.0' }, [
            b('c_port', { PORT: '8080', NAME: 'http', PROTO: 'TCP' }),
            b('c_env', { K: 'TZ', V: 'Europe/Berlin' }),
          ]),
          b('pod_pull_secret', { NAME: 'regcred' }),
        ],
        0,
        0,
      ),
    );
    await shot('stapel', WORKBENCH);

    await loadAt(at([b('k8s_deployment', { NAME: 'web', REPLICAS: '2' }), b('c_port', { PORT: '8080', NAME: 'http', PROTO: 'TCP' }), container([])], 0, 0));
    await wait(400);
    await js(`
      const blk = __byob.ws.getAllBlocks(false).find((x) => x.type === 'c_port');
      for (let i = 0; i < 20 && !blk.getIcons().length; i++) await new Promise((r) => setTimeout(r, 100));
      const icon = blk.getIcons().find((ic) => String(ic.getType()) === 'warning');
      if (icon) await icon.setBubbleVisible(true);
    `);
    await shot('warnung-blase', () => {
      const c = __h.rect('.canvas');
      return { x: c.x, y: c.y + 36, width: c.width, height: 300 };
    });

    const extrasScenes = [
      [
        'extras-feld',
        [
          b('k8s_deployment', { NAME: 'web', REPLICAS: '2' }),
          b('x_field', { PATH: 'spec.revisionHistoryLimit', VAL: '3' }),
          b('x_field', { PATH: 'spec.template.spec.hostNetwork', VAL: 'true' }),
          b('pod_container', { NAME: 'web', IMAGE: 'nginx:1.27' }, [b('x_field', { PATH: 'securityContext.seccompProfile', VAL: '{type: RuntimeDefault}' })]),
        ],
      ],
      [
        'extras-liste',
        [
          b('k8s_deployment', { NAME: 'worker', REPLICAS: '2' }),
          b('x_list', { PATH: 'spec.template.spec.tolerations', VAL: '{key: dedicated, operator: Exists}' }),
          b('pod_container', { NAME: 'worker', IMAGE: 'busybox:1.36' }, [b('x_list', { PATH: 'env', VAL: '{name: POD_IP, valueFrom: {fieldRef: {fieldPath: status.podIP}}}' })]),
        ],
      ],
      [
        'extras-yaml',
        [
          b('k8s_deployment', { NAME: 'web', REPLICAS: '1' }),
          b('x_yaml', { Y: '{metadata: {annotations: {app.openshift.io/connects-to: db}}}' }),
          b('pod_container', { NAME: 'web', IMAGE: 'nginx:1.27' }, []),
        ],
      ],
      [
        'extras-ressource',
        [
          b('k8s_custom', { NAME: 'web-pdb', KIND: 'PodDisruptionBudget', API: 'policy/v1' }),
          b('x_field', { PATH: 'spec.minAvailable', VAL: '1' }),
          b('x_field', { PATH: 'spec.selector.matchLabels', VAL: '{app: web}' }),
        ],
      ],
      [
        'extras-override',
        [
          b('k8s_deployment', { NAME: 'web', REPLICAS: '2' }),
          b('x_field', { PATH: 'spec.selector', VAL: '{matchLabels: {app: web, tier: fe}}' }),
          b('pod_label', { K: 'tier', V: 'fe' }),
          b('pod_container', { NAME: 'web', IMAGE: 'nginx:1.27' }, []),
        ],
      ],
    ];
    for (const [name, blocks] of extrasScenes) {
      await loadAt(at(blocks, 0, 0));
      await shot(name, WORKBENCH);
    }

    // ---------- 13. OpenShift demo project ----------
    step('openshift scenes');
    await js(`__h.click('.project-switch')`);
    await wait(500);
    await js(`__h.click('.modal .link', 'OpenShift Demo-App')`);
    await wait(1300);
    await js(`__h.click('.file-list li', '04-deployment')`);
    await wait(900);
    await shot('app');
    for (const [file, name] of [
      ['02-imagestream', 'os-imagestream'],
      ['03-buildconfig', 'os-buildconfig'],
      ['04-deployment', 'os-deployment'],
      ['05-service', 'os-service'],
      ['06-route', 'os-route'],
      ['12-hpa', 'os-hpa'],
    ]) {
      await js(`__h.click('.file-list li', ${JSON.stringify(file)})`);
      await wait(800);
      await shot(name, WORKBENCH);
    }

    // dev/prod with project variables (APP, NAMESPACE, REPLICAS)
    await js(`__h.click('.file-list li', 'resource.yaml')`);
    await wait(800);
    await loadAt(
      at(
        [
          b('k8s_deployment', { NAME: '${APP}', REPLICAS: '${REPLICAS}' }),
          b('meta_namespace', { NS: '${NAMESPACE}' }),
          b('pod_container', { NAME: '${APP}', IMAGE: 'registry.example.com/${APP}:latest' }, [b('c_resources', { KIND: 'limits', CPU: '500m', MEM: '512Mi' })]),
        ],
        0,
        0,
      ),
      at([b('k8s_route', { NAME: '${APP}', SVC: '${APP}', PORT: 'http' }), b('meta_namespace', { NS: '${NAMESPACE}' }), b('route_host', { HOST: '${APP}.${NAMESPACE}.apps.example.com' }), b('route_tls', { TERM: 'edge', INSEC: 'Redirect' })], 0, 260),
    );
    await shot('devprod-dev', WORKBENCH);
    await js(`__h.setVal(__h.q('.env-select select'), 'prod')`);
    await wait(500);
    await shot('devprod-prod', WORKBENCH);
    await js(`__h.setVal(__h.q('.env-select select'), 'dev')`);

    step('done');
  } catch (e) {
    console.error('[screens] FAILED', e);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.quit(), 300);
  }
};
