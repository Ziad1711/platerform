import fs from 'node:fs'

const ref = fs.readFileSync(new URL('../.work/snapshot.sql', import.meta.url), 'utf8')
const marker = /-- @@FUNCTION ([0-9a-f]{32}) ([^\r\n]+)\r?\n([\s\S]*?)\r?\n-- @@END/g
let count = 0

const exec = ref.replace(marker, (_all, md5, signature, body) => {
  count += 1
  const trimmed = body.replace(/\s+$/, '')
  const statement = trimmed.endsWith(';') ? trimmed : `${trimmed};`
  return `-- @@FUNCTION ${md5} ${signature}\n${statement}\n-- @@END`
})

if (count !== 23) throw new Error(`expected 23 functions, got ${count}`)
fs.writeFileSync(new URL('../.work/snapshot.exec.sql', import.meta.url), exec)
