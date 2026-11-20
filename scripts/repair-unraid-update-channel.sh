#!/bin/sh
# One-time repair for older installed Compose files. Subsequent updates use the
# operator's ordinary stop -> pull/update -> start workflow.
set -eu
mode=${1:---check}
case "$mode" in --check|--apply) ;; *) echo 'Use --check or --apply.' >&2; exit 2;; esac
[ "$(hostname)" = Horoserve ] || { echo 'Run this on Horoserve, in the Unraid terminal.' >&2; exit 1; }
project=/boot/config/plugins/compose.manager/projects/mtg-archives
cd "$project"
test -f compose.yaml && test -f .env
umask 077
owner="main-channel-repair-$(date -u +%Y%m%dT%H%M%SZ)-$$"
lock="$project/.codex-deploy.lock"
mkdir "$lock" 2>/dev/null || { echo 'Another stack operation owns the deployment lock; stop here.' >&2; exit 1; }
printf '%s\n' "$owner" > "$lock/owner"
backup=''
writing=0
cleanup() {
  code=$?
  trap - EXIT HUP INT TERM
  if [ "$code" -ne 0 ] && [ "$writing" -eq 1 ]; then
    cp -p "$backup/compose.yaml" "$project/compose.yaml"
    cp -p "$backup/.env" "$project/.env"
    echo 'The configuration repair failed; the original files were restored.' >&2
  fi
  if [ -f "$lock/owner" ] && [ "$(cat "$lock/owner")" = "$owner" ]; then
    rm "$lock/owner"
    rmdir "$lock"
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
backup=$(mktemp -d "$project/main-channel-backup.XXXXXXXX")
cp -p compose.yaml "$backup/compose.yaml"
cp -p .env "$backup/.env"

# Use the application's existing YAML/dotenv libraries in a short-lived,
# network-isolated helper. This also works when the application stack is down.
helper=ghcr.io/sefaction/mtg-archives-web:main
docker image inspect "$helper" >/dev/null 2>&1 || docker pull "$helper"
normalizer=$(cat <<'NODE'
try {
const fs=require('node:fs'),yaml=require('js-yaml'),dotenv=require('dotenv'),assert=require('node:assert/strict');
const text=fs.readFileSync(0,'utf8');
const refs={WEB_IMAGE:'ghcr.io/sefaction/mtg-archives-web:main',ACQUISITION_RECOGNITION_IMAGE:'ghcr.io/sefaction/mtg-archives-recognition:main',ACQUISITION_VISUAL_IMAGE:'ghcr.io/sefaction/mtg-archives-visual:main',IMAGE_TAG:'main'};
if(process.argv[1]==='env'){
  const before=dotenv.parse(text);
  const kept=text.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?(?:WEB_IMAGE|ACQUISITION_RECOGNITION_IMAGE|ACQUISITION_VISUAL_IMAGE|IMAGE_TAG)\s*=/.test(line));
  const next=kept.join('\n').replace(/\n*$/,'\n')+Object.entries(refs).map(([k,v])=>`${k}=${v}`).join('\n')+'\n';
  const after=dotenv.parse(next);
  for(const [k,v] of Object.entries(before))if(!(k in refs))assert.equal(after[k],v,'Unrelated environment value changed');
  process.stdout.write(next);
}else{
  const doc=yaml.load(text),before=structuredClone(doc);
  assert(doc?.services?.web,'Expected existing MTG Archives web service');
  const names={WEB_IMAGE:'web',ACQUISITION_RECOGNITION_IMAGE:'recognition',ACQUISITION_VISUAL_IMAGE:'visual'};
  const changed=[];
  for(const [name,service] of Object.entries(doc.services)){
    const image=String(service.image??'');
    const found=image.match(/ghcr\.io\/sefaction\/mtg-archives-(web|recognition|visual)(?=[:@}]|$)/);
    const variable=image.match(/^\$\{(WEB_IMAGE|ACQUISITION_RECOGNITION_IMAGE|ACQUISITION_VISUAL_IMAGE)(?=[:}])/);
    const component=found?.[1]??(variable&&names[variable[1]]);
    if(component){service.image=`ghcr.io/sefaction/mtg-archives-${component}:main`;service.pull_policy='always';changed.push(name);}
  }
  assert(changed.length>0,'No recognized MTG Archives image references; inspect the custom configuration');
  assert.equal(doc.services.web.image,refs.WEB_IMAGE,'Custom web image requires operator review');
  const unchanged=value=>{const copy=structuredClone(value);for(const name of changed){delete copy.services[name].image;delete copy.services[name].pull_policy;}return copy;};
  assert.deepEqual(unchanged(doc),unchanged(before),'Unrelated Compose settings changed');
  process.stdout.write(yaml.dump(doc,{lineWidth:-1,noRefs:true}));
}
} catch {
  console.error('Configuration could not be safely normalized. Original files are unchanged; inspect the private backup locally.');
  process.exitCode=1;
}
NODE
)
docker run --rm -i --pull never --network none --memory 192m --cpus 0.5 --pids-limit 32 --entrypoint node "$helper" -e "$normalizer" compose < compose.yaml > "$backup/compose.next.yaml"
docker run --rm -i --pull never --network none --memory 192m --cpus 0.5 --pids-limit 32 --entrypoint node "$helper" -e "$normalizer" env < .env > "$backup/.env.next"
if ! docker compose --project-directory "$project" --env-file "$backup/.env.next" -p mtg-archives -f "$backup/compose.next.yaml" config --quiet > "$backup/validation.log" 2>&1; then
  printf 'Compose validation failed; original files are unchanged. Private details: %s/validation.log\n' "$backup" >&2
  exit 1
fi
docker compose --project-directory "$project" --env-file "$backup/.env.next" -p mtg-archives -f "$backup/compose.next.yaml" config --images > "$backup/images.next.txt" 2>> "$backup/validation.log"
if grep -E '^ghcr\.io/sefaction/mtg-archives-(web|recognition|visual)(:|@)' "$backup/images.next.txt" | grep -vE ':main$'; then
  echo 'An application image is still pinned; configuration was not changed.' >&2
  exit 1
fi
cmp -s compose.yaml "$backup/compose.yaml" && cmp -s .env "$backup/.env" || { echo 'Configuration changed during repair; stop and recheck.' >&2; exit 1; }
if [ "$mode" = --apply ]; then
  writing=1
  mv "$backup/compose.next.yaml" compose.yaml
  mv "$backup/.env.next" .env
  writing=0
  printf 'Restored normal main-channel updates. Backup: %s\nNow use your usual stop, pull/update, start procedure.\n' "$backup"
else
  printf 'Configuration check passed; candidates and original copies: %s\nRun with --apply to restore normal updates.\n' "$backup"
fi
