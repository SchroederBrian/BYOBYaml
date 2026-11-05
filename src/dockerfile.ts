import type * as Blockly from 'blockly/core';
import { T, M, N, D, type BlockSpec, type CatId } from './blocks/types';
import type { GenResult, GenWarning } from './blocks/generator';
import type { ProjectFile } from './project';

const def = (type: string, cat: CatId, msg: string, args: BlockSpec['args'] = [], tip = ''): BlockSpec => ({ type: `df_${type}`, cat, shape: type === 'file' ? 'hat' : 'stmt', msg, args, scope: ['dockerfile'], where: 'in eine Dockerfile-Datei, unter den Dockerfile-Startblock', tip, gen: () => {} });
const argumentsTip = 'Ein Argument je Zeile, ohne zusätzliche Anführungszeichen. Alternativ eine JSON-Liste. Leerzeichen innerhalb einer Zeile gehören zum Argument.';
export const DOCKERFILE_BLOCKS: BlockSpec[] = [
  def('file','dockerImage','Dockerfile',[],'Ein Startblock pro Datei. FROM beginnt eine Build-Phase; weitere FROM-Blöcke ergeben einen Multi-Stage-Build.'),
  def('from','dockerImage','FROM Image %1 Phase %2 Plattform %3',[T('IMAGE','alpine:3'),T('STAGE',''),T('PLATFORM','')],'Phase und Plattform sind optional. Benannte Phasen können später als Basis oder COPY-Quelle verwendet werden.'),
  def('arg','dockerImage','ARG Build-Variable %1 Standard %2',[T('NAME','VERSION'),T('VALUE','')],'Build-Argument; vor FROM gilt es für Basis-Images. In einer Phase erneut deklarieren, um es dort zu verwenden. Keine Zugangsdaten eintragen.'),
  def('comment','dockerImage','Kommentar %1',[M('TEXT','Eigenes Container-Image')]),
  def('run','dockerBuild','RUN Shell-Befehl %1',[M('COMMAND','echo "Build-Schritt"')],'Mehrere Zeilen werden als zusammenhängendes Shell-Skript mit einem Here-Document ausgegeben.'),
  def('run_exec','dockerBuild','RUN Programm & Argumente %1',[M('ARGS','echo\nBuild-Schritt')],argumentsTip),
  def('copy','dockerBuild','COPY Quellen %1 nach %2 aus Phase/Image %3 Besitzer %4 Rechte %5',[M('SOURCES','.'),T('DEST','/app/'),T('FROM',''),T('CHOWN',''),T('CHMOD','')],'Eine Quelle je Zeile. Phase/Image, Besitzer und Rechte sind optional. Für mehrere Quellen muss das Ziel mit / enden.'),
  def('add','dockerBuild','ADD Quellen %1 nach %2 Besitzer %3 Rechte %4',[M('SOURCES','assets/'),T('DEST','/app/assets/'),T('CHOWN',''),T('CHMOD','')],'Lokale Quellen oder URLs, eine je Zeile. Für einfache lokale Dateien ist COPY meist passend.'),
  def('workdir','dockerBuild','WORKDIR Arbeitsordner %1',[T('PATH','/app')]),
  def('run_cache','dockerBuild','RUN mit Cache Ziel %1 gemeinsam %2 Befehl %3',[T('TARGET','/root/.cache'),D('SHARING',['shared','locked','private']),M('COMMAND','echo "Build mit Cache"')],'BuildKit-Cache bleibt außerhalb des Image-Layers. Ziel muss ein absoluter Pfad ohne Leerzeichen sein.'),
  def('run_secret','dockerBuild','RUN mit Build-Secret ID %1 Ziel %2 Befehl %3',[T('ID','build-token'),T('TARGET','/run/secrets/build-token'),M('COMMAND','test -s /run/secrets/build-token')],'Nur die Secret-ID speichern. Beim Build --secret id=build-token,src=... angeben. Der Befehl darf das Secret nicht selbst ins Image kopieren.'),
  def('env','dockerRuntime','ENV Variable %1 Wert %2',[T('NAME','APP_ENV'),T('VALUE','production')],'ENV bleibt im Image sichtbar. Zugangsdaten über Laufzeit-Secrets oder Build-Secret-Mounts bereitstellen.'),
  def('label','dockerRuntime','LABEL Schlüssel %1 Wert %2',[T('NAME','org.opencontainers.image.title'),T('VALUE','Meine Anwendung')]),
  def('expose','dockerRuntime','EXPOSE Port %1 %2',[N('PORT',8080,1,1),D('PROTO',['tcp','udp'])],'Dokumentiert den Container-Port. Die Veröffentlichung erfolgt später mit docker run -p oder über Compose/Kubernetes.'),
  def('user','dockerRuntime','USER Benutzer oder UID:Gruppe %1',[T('USER','1000:1000')]),
  def('cmd','dockerRuntime','CMD Startprogramm & Argumente %1',[M('ARGS','sh')],argumentsTip),
  def('entrypoint','dockerRuntime','ENTRYPOINT Programm & Argumente %1',[M('ARGS','/usr/local/bin/entrypoint.sh')],argumentsTip),
  def('cmd_shell','dockerRuntime','CMD Shell-Befehl %1',[T('COMMAND','echo "Hallo"')],'Shell-Form; CMD mit Programm und Argumenten ist für direkte Prozesse meist geeigneter.'),
  def('entrypoint_shell','dockerRuntime','ENTRYPOINT Shell-Befehl %1',[T('COMMAND','exec /app/start.sh')]),
  def('volume','dockerRuntime','VOLUME Pfade %1',[M('PATHS','/data')],'Ein absoluter Container-Pfad je Zeile.'),
  def('shell','dockerRuntime','SHELL Programm & Argumente %1',[M('ARGS','/bin/sh\n-c')],argumentsTip),
  def('stopsignal','dockerRuntime','STOPSIGNAL Signal %1',[T('SIGNAL','SIGTERM')]),
  def('healthcheck','dockerRuntime','HEALTHCHECK Befehl %1 Intervall %2 Timeout %3 Startphase %4 Versuche %5',[T('COMMAND','wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1'),T('INTERVAL','30s'),T('TIMEOUT','3s'),T('START','5s'),N('RETRIES',3,1,1)]),
  def('health_none','dockerRuntime','HEALTHCHECK ausschalten'),
];
const specs = new Map(DOCKERFILE_BLOCKS.map((spec) => [spec.type,spec]));
export const isDockerfileName = (name: string) => /^(?:Dockerfile(?:[.-].*)?|.+\.dockerfile)$/i.test(name.replace(/\\/g,'/').split('/').pop() ?? '');
const scalar = (value: unknown) => String(value ?? '');
const oneLine = (value: unknown, label: string, required = true) => {
  const result = scalar(value).trim();
  if (/[\r\n\u0000-\u001f\u007f]/.test(result) || required && !result) throw new Error(`${label}: Bitte einen gültigen einzeiligen Wert eingeben.`);
  return result;
};
const symbolic = (value: string) => value.replace(/\$(?:\{[^}\r\n]+\}|[A-Za-z_][\w]*)/g,'byob');
const reference = (value: string) => /^(?:[A-Za-z0-9_.:[\]-]+\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]*)?(?:@[A-Za-z][A-Za-z0-9_+.-]*:[A-Za-z0-9=_-]+)?$/.test(symbolic(value));
export function dockerArguments(raw: string): string[] {
  let values: unknown;
  if (raw.trim().startsWith('[')) { try { values = JSON.parse(raw); } catch { throw new Error('Die Argumentliste ist kein gültiges JSON. Alternativ ein Argument je Zeile eingeben.'); } }
  else values = raw.replace(/\r\n?/g,'\n').split('\n').filter((line) => line.length > 0);
  if (!Array.isArray(values) || !values.length || values.length > 200 || values.some((value) => typeof value !== 'string' || /[\u0000]/.test(value))) throw new Error('Mindestens ein gültiges Argument ist erforderlich (höchstens 200).');
  return values;
}
function shellRun(command: string, flags = ''): string {
  const script = command.replace(/\r\n?/g,'\n').trim();
  if (!script || /\u0000/.test(script) || /^--/.test(script)) throw new Error('RUN benötigt einen Befehl. Build-Flags über die passenden Mount-Blöcke einstellen.');
  if (!script.includes('\n') && !script.endsWith('\\') && !/<<-?\s*['"]?[\w]+/.test(script)) return `RUN ${flags}${script}`;
  let delimiter = 'BYOB_RUN'; while (script.split('\n').some((line) => line.trim() === delimiter)) delimiter += '_END';
  return `RUN ${flags}<<'${delimiter}'\n${script}\n${delimiter}`;
}
export function dockerfileState(instructions: { type: string; fields?: Record<string, any> }[]): any {
  let next: any;
  for (const instruction of [...instructions].reverse()) next = { ...instruction, ...(next ? { next: { block: next } } : {}) };
  return { blocks: { languageVersion: 0, blocks: [{ type: 'df_file', x: 32, y: 32, ...(next ? { next: { block: next } } : {}) }] } };
}

/** Data-only validation and emission; shared by live and isolated export workspaces. */
export function generateDockerfile(workspace: Blockly.Workspace, variables: Record<string,string> = {}): GenResult {
  const warnings: GenWarning[] = [], touched = new Set<string>(), lines = ['# syntax=docker/dockerfile:1',''];
  let blocked = false, stageCount = 0;
  const stages = new Map<string,number>(), singleton = new Map<string,string>();
  const report = (block: Blockly.Block, msg: string, error = true) => { warnings.push({ blockId:block.id,msg }); if (error) blocked = true; };
  const all = workspace.getAllBlocks(false), roots = workspace.getTopBlocks(true).filter((block) => block.type === 'df_file' && block.isEnabled());
  all.forEach((block) => block.setWarningText?.(null));
  if (roots.length !== 1) {
    all.filter((block) => block.isEnabled()).forEach((block) => report(block, 'Eine Dockerfile-Datei benötigt genau einen aktiven Dockerfile-Startblock.'));
    return { yaml:'',docs:0,warnings,blocked:true };
  }
  const root = roots[0]; touched.add(root.id);
  for (let block = root.getNextBlock(); block; block = block.getNextBlock()) {
    touched.add(block.id); if (!block.isEnabled()) continue;
    const spec = specs.get(block.type);
    if (!spec || spec.shape === 'hat') { report(block,'Hier sind ausschließlich Dockerfile-Anweisungen erlaubt.'); continue; }
    const value: Record<string,string> = {};
    for (const arg of spec.args ?? []) {
      const raw = block.getFieldValue(arg.name) ?? (arg.kind === 'dd' ? arg.options[0][1] : arg.value);
      value[arg.name] = scalar(raw).replace(/\$\{([A-Za-z_][\w.-]*)\}/g,(match,name) => Object.hasOwn(variables,name) ? variables[name] : match);
    }
    try {
      if (!stageCount && !['df_arg','df_comment','df_from'].includes(block.type)) throw new Error('Diese Anweisung muss nach einem FROM-Block stehen.');
      let line = '';
      const once = (name: string) => { if (singleton.has(name)) report(block,`${name} ist in dieser Phase mehrfach gesetzt. Docker verwendet die letzte Anweisung.`,false); singleton.set(name,block.id); };
      const args = () => dockerArguments(value.ARGS);
      switch (block.type) {
        case 'df_comment': line = value.TEXT.replace(/\r\n?/g,'\n').split('\n').map((text) => `# ${/^\s*(?:syntax|escape|check)\s*=/i.test(text) ? 'Notiz: ' : ''}${text}`).join('\n'); break;
        case 'df_from': {
          const image = oneLine(value.IMAGE,'Basis-Image'), stage = oneLine(value.STAGE,'Phase',false), platform = oneLine(value.PLATFORM,'Plattform',false);
          if (!reference(image)) throw new Error('Ungültige Image-Referenz. Beispiel: alpine:3 oder registry.example.org/team/app:1.0.');
          if (stage && (!/^[a-z][a-z0-9_-]*$/.test(stage) || ['scratch','context'].includes(stage) || stages.has(stage))) throw new Error('Phasennamen müssen eindeutig sein und mit einem Kleinbuchstaben beginnen. „scratch“ und „context“ sind reserviert.');
          if (platform && !/^[a-z0-9_-]+\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/.test(symbolic(platform)) && !/^\$\{?\w+\}?$/.test(platform)) throw new Error('Plattform zum Beispiel linux/amd64 oder $BUILDPLATFORM angeben.');
          if (stage) stages.set(stage,stageCount); stageCount++; singleton.clear();
          line = `${stageCount > 1 ? '\n' : ''}FROM ${platform ? `--platform=${platform} ` : ''}${image}${stage ? ` AS ${stage}` : ''}`; break;
        }
        case 'df_arg': case 'df_env': case 'df_label': {
          const name = oneLine(value.NAME,'Schlüssel'), content = oneLine(value.VALUE,'Wert',false);
          if (!(block.type === 'df_label' ? /^[A-Za-z0-9][A-Za-z0-9_.-]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/).test(name)) throw new Error('Ungültiger Variablen- oder Label-Schlüssel.');
          if (block.type !== 'df_label' && /password|passwd|secret|token|api_?key|private_?key/i.test(name)) report(block,'Zugangsdaten nicht in ARG oder ENV einbauen. Für Build-Zugriffe den Build-Secret-Block verwenden.',false);
          line = block.type === 'df_arg' ? `ARG ${name}${content ? `=${JSON.stringify(content)}` : ''}` : `${block.type === 'df_env' ? 'ENV' : 'LABEL'} ${name}=${JSON.stringify(content)}`; break;
        }
        case 'df_run': line = shellRun(value.COMMAND); break;
        case 'df_run_exec': line = `RUN ${JSON.stringify(args())}`; break;
        case 'df_run_cache': case 'df_run_secret': {
          const target = oneLine(value.TARGET,'Mount-Ziel');
          if (!target.startsWith('/') || /[\s,\\]/.test(target)) throw new Error('Mount-Ziel als absoluten Linux-Pfad ohne Leerzeichen oder Komma angeben.');
          if (block.type === 'df_run_cache') {
            if (!['shared','locked','private'].includes(value.SHARING)) throw new Error('Ungültiger Cache-Modus.');
            line = shellRun(value.COMMAND,`--mount=type=cache,target=${target},sharing=${value.SHARING} `);
          } else {
            const id = oneLine(value.ID,'Secret-ID'); if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('Secret-ID darf nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten.');
            line = shellRun(value.COMMAND,`--mount=type=secret,id=${id},target=${target},required=true `);
          } break;
        }
        case 'df_copy': case 'df_add': {
          const sources = dockerArguments(value.SOURCES), dest = oneLine(value.DEST,'Zielpfad'), from = oneLine(value.FROM,'Quellphase',false), owner = oneLine(value.CHOWN,'Besitzer',false), mode = oneLine(value.CHMOD,'Dateirechte',false);
          if (sources.some((source) => !source || /[\r\n]/.test(source) || source.split('/').includes('..'))) throw new Error('Quellpfade dürfen nicht leer sein oder mit .. aus dem Build-Kontext herausführen.');
          if (sources.length > 1 && !dest.endsWith('/')) throw new Error('Bei mehreren COPY-/ADD-Quellen muss das Ziel mit / enden.');
          if (from && (/^\d+$/.test(from) && +from >= stageCount - 1 || !/^\d+$/.test(from) && !reference(from))) throw new Error('COPY benötigt eine frühere Phase, einen benannten Build-Kontext oder ein gültiges Image als Quelle.');
          if (from && stages.get(from) === stageCount - 1) throw new Error('Eine Phase kann nicht aus sich selbst kopieren.');
          if (owner && !/^[A-Za-z0-9_$}{:.-]+$/.test(owner)) throw new Error('Besitzer als Benutzer[:Gruppe] oder UID[:GID] angeben.');
          if (mode && !/^[0-7]{3,4}$/.test(mode) && !/^[ugoa]*[+=-][rwxXstugo]*(?:,[ugoa]*[+=-][rwxXstugo]*)*$/.test(mode) && !/^\$\{\w+\}$/.test(mode)) throw new Error('Dateirechte zum Beispiel 755, 0644 oder u=rwX,go=rX angeben.');
          line = `${block.type === 'df_copy' ? 'COPY' : 'ADD'} ${from ? `--from=${from} ` : ''}${owner ? `--chown=${owner} ` : ''}${mode ? `--chmod=${mode} ` : ''}${JSON.stringify([...sources,dest])}`; break;
        }
        case 'df_workdir': { const path = oneLine(value.PATH,'Arbeitsordner'); if (!/^(?:\/|[A-Za-z]:[\\/]|\$)/.test(path)) report(block,'Ein relativer WORKDIR hängt vom Basis-Image ab. Ein absoluter Pfad ist eindeutiger.',false); line = `WORKDIR ${path}`; break; }
        case 'df_user': { const user = oneLine(value.USER,'Benutzer'); if (!/^[A-Za-z0-9_.${}-]+(?::[A-Za-z0-9_.${}-]+)?$/.test(user)) throw new Error('Benutzer als Name oder UID, optional mit :Gruppe, angeben.'); line = `USER ${user}`; break; }
        case 'df_expose': { const port = Number(value.PORT); if (!Number.isInteger(port) || port < 1 || port > 65535 || !['tcp','udp'].includes(value.PROTO)) throw new Error('EXPOSE benötigt einen Port zwischen 1 und 65535 und tcp oder udp.'); line = `EXPOSE ${port}/${value.PROTO}`; break; }
        case 'df_cmd': case 'df_entrypoint': case 'df_shell': { const name = block.type.slice(3).toUpperCase(); if (name !== 'SHELL') once(name); const argv = args(); if (!argv[0]) throw new Error('Das Programm darf nicht leer sein.'); line = `${name} ${JSON.stringify(argv)}`; break; }
        case 'df_cmd_shell': case 'df_entrypoint_shell': { const name = block.type === 'df_cmd_shell' ? 'CMD' : 'ENTRYPOINT'; once(name); const command = oneLine(value.COMMAND,'Shell-Befehl'); if (command.endsWith('\\')) throw new Error('Ein Shell-Befehl darf nicht mit einem Fortsetzungszeichen enden.'); line = `${name} ${command}`; break; }
        case 'df_volume': { const paths = dockerArguments(value.PATHS); if (paths.some((path) => !/^(?:\/|[A-Za-z]:[\\/])/.test(path))) throw new Error('VOLUME benötigt absolute Container-Pfade.'); line = `VOLUME ${JSON.stringify(paths)}`; break; }
        case 'df_stopsignal': { const signal = oneLine(value.SIGNAL,'Signal'); const signals = ['HUP','INT','QUIT','ILL','TRAP','ABRT','BUS','FPE','KILL','USR1','SEGV','USR2','PIPE','ALRM','TERM','CHLD','CONT','STOP','TSTP','TTIN','TTOU','URG','XCPU','XFSZ','VTALRM','PROF','WINCH','IO','PWR','SYS']; if (!signals.some((name) => `SIG${name}` === signal) && !(/^[1-9]\d*$/.test(signal) && +signal <= 64)) throw new Error('Ein bekanntes Linux-Signal wie SIGTERM oder eine Signalnummer von 1 bis 64 angeben.'); line = `STOPSIGNAL ${signal}`; break; }
        case 'df_health_none': once('HEALTHCHECK'); line = 'HEALTHCHECK NONE'; break;
        case 'df_healthcheck': {
          once('HEALTHCHECK'); const flags: string[] = [];
          for (const [field,flag] of [['INTERVAL','interval'],['TIMEOUT','timeout'],['START','start-period']]) { const duration = oneLine(value[field],flag,false); if (!duration) continue; if (!/^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/.test(duration) || !/[1-9]/.test(duration)) throw new Error(`${flag}: Positive Dauer wie 30s, 500ms oder 1m30s angeben.`); flags.push(`--${flag}=${duration}`); }
          const retries = Number(value.RETRIES), command = oneLine(value.COMMAND,'Healthcheck-Befehl'); if (!Number.isInteger(retries) || retries < 1 || retries > 1000 || command.endsWith('\\')) throw new Error('Healthcheck benötigt 1–1000 Versuche und einen vollständigen einzeiligen Befehl.');
          line = `HEALTHCHECK ${flags.join(' ')} --retries=${retries} CMD ${command}`; break;
        }
      }
      lines.push(line);
    } catch (error) { report(block,error instanceof Error ? error.message : 'Ungültige Dockerfile-Anweisung.'); }
  }
  if (!stageCount) report(root,'Mindestens ein FROM-Block mit einem Basis-Image ist erforderlich.');
  for (const block of all) {
    if (!touched.has(block.id) && block.isEnabled()) report(block,'Dieser Block ist nicht mit dem Dockerfile-Start verbunden und wird nicht ausgegeben.',false);
    block.setWarningText?.(warnings.filter((warning) => warning.blockId === block.id).map((warning) => warning.msg).join('\n') || null);
  }
  return { yaml:stageCount ? `${lines.join('\n')}\n` : '',docs:stageCount ? 1 : 0,warnings,...(blocked ? { blocked:true } : {}) };
}

export function importDockerfile(text: string, name = 'Dockerfile'): { file: ProjectFile; notes: string[] } {
  if (text.length > 1000000 || text.includes('\u0000')) throw new Error('Die Dockerfile ist zu groß oder enthält ungültige Zeichen.');
  const input = text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n'), instructions: { type:string; fields?:Record<string,any> }[] = [];
  const fail = (line: number, detail: string): never => { throw new Error(`Dockerfile, Zeile ${line}: ${detail} Die Originaldatei wurde nicht verändert.`); };
  for (let i = 0; i < input.length; i++) {
    let line = input[i].trim(); if (!line) continue;
    const lineNo = i + 1;
    if (/^#\s*syntax\s*=/.test(line)) { if (!/^#\s*syntax\s*=\s*docker\/dockerfile:1(?:\.\d+)?\s*$/.test(line)) fail(lineNo,'Diese Dockerfile-Syntax wird nicht unterstützt.'); continue; }
    if (/^#\s*(escape|check)\s*=/.test(line)) fail(lineNo,'Eigene escape-/check-Direktiven werden noch nicht importiert.');
    if (line.startsWith('#')) { instructions.push({type:'df_comment',fields:{TEXT:line.slice(1).trimStart()}}); continue; }
    while (line.endsWith('\\')) { line = line.slice(0,-1).trimEnd(); if (++i >= input.length) fail(lineNo,'Unvollständige Zeilenfortsetzung.'); if (input[i].trim().startsWith('#')) { i++; if (i >= input.length) fail(lineNo,'Unvollständige Zeilenfortsetzung.'); } line += ' ' + input[i].trim(); }
    const match = line.match(/^([A-Za-z]+)\s+([\s\S]+)$/); if (!match) fail(lineNo,'Anweisung und Wert fehlen.');
    const op = match![1].toUpperCase(); let body = match![2];
    const add = (type:string,fields:Record<string,any> = {}) => instructions.push({type:`df_${type}`,fields});
    const flags: Record<string,string> = {};
    while (body.startsWith('--')) { const flag = body.match(/^--([a-z-]+)=([^\s]+)\s+/); if (!flag) fail(lineNo,'Dieses Flag-Format wird noch nicht unterstützt.'); flags[flag![1]] = flag![2]; body = body.slice(flag![0].length); }
    const flagCheck = (allowed:string[]) => { if (Object.keys(flags).some((key) => !allowed.includes(key))) fail(lineNo,'Eine erweiterte Build-Option wird noch nicht unterstützt.'); };
    const words = (raw:string): string[] => { const result:string[] = []; let word='',quote='',started=false; for(let j=0;j<raw.length;j++){ const ch=raw[j]; if(ch==='\\' && quote!=="'"){ if(j+1>=raw.length) fail(lineNo,'Unvollständiges Escape.'); word+=raw[++j];started=true; } else if(quote){ if(ch===quote)quote='';else word+=ch; } else if(ch==='"'||ch==="'"){ quote=ch;started=true; } else if(/\s/.test(ch)){if(started){result.push(word);word='';started=false;}}else{word+=ch;started=true;} } if(quote)fail(lineNo,'Anführungszeichen sind nicht geschlossen.');if(started)result.push(word);return result; };
    const array = () => body.trim().startsWith('[') ? dockerArguments(body) : words(body);
    if (op !== 'RUN' && /<</.test(body)) fail(lineNo,'Here-Documents werden für diese Anweisung noch nicht importiert.');
    switch(op){
      case 'FROM': {flagCheck(['platform']);const from=body.match(/^(\S+)(?:\s+AS\s+(\S+))?$/i);if(!from)fail(lineNo,'FROM konnte nicht gelesen werden.');add('from',{IMAGE:from![1],STAGE:from![2]??'',PLATFORM:flags.platform??''});break;}
      case 'RUN': {flagCheck(['mount']);let command=body;const here=body.match(/^<<(['"]?)([A-Za-z_]\w*)\1$/);if(here){const script:string[]=[];while(++i<input.length&&input[i]!==here[2])script.push(input[i]);if(i>=input.length)fail(lineNo,'Here-Document ist nicht geschlossen.');command=script.join('\n');}else if(/<</.test(body))fail(lineNo,'Diese Here-Document-Variante wird noch nicht unterstützt.');if(flags.mount){const mount=Object.fromEntries(flags.mount.split(',').map((part)=>part.split('=')));if(mount.type==='cache'&&Object.keys(mount).every((key)=>['type','target','sharing'].includes(key)))add('run_cache',{TARGET:mount.target??'',SHARING:mount.sharing??'shared',COMMAND:command});else if(mount.type==='secret'&&mount.required==='true'&&Object.keys(mount).every((key)=>['type','id','target','required'].includes(key)))add('run_secret',{ID:mount.id??'',TARGET:mount.target??'',COMMAND:command});else fail(lineNo,'Dieser Mount wird noch nicht unterstützt.');}else if(body.trim().startsWith('['))add('run_exec',{ARGS:JSON.stringify(dockerArguments(body))});else add('run',{COMMAND:command});break;}
      case 'COPY':case 'ADD':{flagCheck(op==='COPY'?['from','chown','chmod']:['chown','chmod']);const values=array();if(values.length<2)fail(lineNo,'Quelle oder Ziel fehlt.');add(op.toLowerCase(),{SOURCES:JSON.stringify(values.slice(0,-1)),DEST:values.at(-1),...(op==='COPY'?{FROM:flags.from??''}:{}),CHOWN:flags.chown??'',CHMOD:flags.chmod??''});break;}
      case 'ARG':{flagCheck([]);if(/\\\$|'[^']*\$/.test(body))fail(lineNo,'Diese maskierte Variablen-Schreibweise wird noch nicht importiert.');const parts=words(body);if(parts.length!==1)fail(lineNo,'ARG benötigt einen Namen und optional einen in Anführungszeichen gesetzten Standardwert.');const at=parts[0].indexOf('=');add('arg',{NAME:at<0?parts[0]:parts[0].slice(0,at),VALUE:at<0?'':parts[0].slice(at+1)});break;}
      case 'ENV':case 'LABEL':{flagCheck([]);if(/\\\$|'[^']*\$/.test(body))fail(lineNo,'Diese maskierte Variablen-Schreibweise wird noch nicht importiert.');const parts=words(body);if(parts.some((part)=>!part.includes('=')))fail(lineNo,'Bitte die Schreibweise NAME=WERT verwenden.');for(const part of parts){const at=part.indexOf('=');add(op.toLowerCase(),{NAME:part.slice(0,at),VALUE:part.slice(at+1)});}break;}
      case 'CMD':case 'ENTRYPOINT':case 'SHELL':{flagCheck([]);if(body.trim().startsWith('['))add(op.toLowerCase(),{ARGS:JSON.stringify(dockerArguments(body))});else if(op==='SHELL')fail(lineNo,'SHELL benötigt eine JSON-Liste.');else add(`${op.toLowerCase()}_shell`,{COMMAND:body});break;}
      case 'WORKDIR':case 'USER':case 'STOPSIGNAL':flagCheck([]);add(op.toLowerCase(),{[op==='WORKDIR'?'PATH':op==='USER'?'USER':'SIGNAL']:body});break;
      case 'EXPOSE':flagCheck([]);for(const part of words(body)){const port=part.match(/^(\d+)(?:\/(tcp|udp))?$/);if(!port)fail(lineNo,'Portformat wird nicht unterstützt.');add('expose',{PORT:port![1],PROTO:port![2]??'tcp'});}break;
      case 'VOLUME':flagCheck([]);add('volume',{PATHS:JSON.stringify(array())});break;
      case 'HEALTHCHECK':flagCheck(['interval','timeout','start-period','retries']);if(body==='NONE')add('health_none');else if(body.startsWith('CMD ')&&!body.slice(4).trim().startsWith('['))add('healthcheck',{COMMAND:body.slice(4),INTERVAL:flags.interval??'',TIMEOUT:flags.timeout??'',START:flags['start-period']??'',RETRIES:flags.retries??'3'});else fail(lineNo,'Diese Healthcheck-Variante wird noch nicht unterstützt.');break;
      default:fail(lineNo,`${op} wird noch nicht importiert. Unterstützte Anweisungen können über die Blockpalette erstellt werden.`);
    }
    if(instructions.length>3000)fail(lineNo,'Zu viele Anweisungen.');
  }
  if(!instructions.some((instruction)=>instruction.type==='df_from'))throw new Error('Keine FROM-Anweisung gefunden.');
  return { file:{id:crypto.randomUUID(),name:isDockerfileName(name)?name:'Dockerfile',kind:'dockerfile',state:dockerfileState(instructions),needsLayout:true},notes:[`${instructions.length} Dockerfile-Anweisungen in Blöcke umgewandelt. Struktur und Werte im Editor prüfen; Image-Build und Build-Kontext werden nicht ausgeführt.`] };
}
