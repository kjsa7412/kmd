// 시험용 `claude setup-token` — 주소를 내고, 번호 한 줄을 받으면 오래 가는 열쇠 모양을 낸다(진짜 Claude 를 부르지 않는다).
// 진짜처럼:
//   · 긴 글(60자 넘게)이 Enter 와 한 덩이로 오면 붙여 넣기로 받아 Enter 를 삼킨다 — Enter 는 따로 와야 한다
//   · 번호가 틀리면(bad) 「OAuth error … Press Enter to retry.」 → Enter 를 받으면 새 주소를 내고 다시 기다린다
let n = 0
const ask = () => process.stdout.write(`Browser didn't open? Use the url below to sign in:\n\nhttps://claude.ai/oauth/authorize?code=true&state=test-${n ? 'retry' + n : '7f3a'}\n\nPaste code here if prompted > `)
ask()
let failed = false
let buf = ''
const submit = (code) => {
  if (failed) { failed = false; n++; process.stdout.write('\nRetrying…'); ask(); return }
  if (code.trim() === 'bad' || code.trim().startsWith('bad-')) { failed = true; process.stdout.write('\nOAuth error: Request failed with status code 400  Press Enter to retry.\n'); return }
  process.stdout.write('\n✓ Long-lived authentication token created successfully!\n\nYour OAuth token (valid for 1 year):\n\nsk-ant-oat01-TESTTOKEN0123456789abcdefABCDEF\n')
  process.exit(0)
}
process.stdin.on('data', (d) => {
  const s = d.toString('utf8')
  const text = s.replace(/[\r\n]+$/, '')
  const hasEnter = text.length !== s.length
  buf += text
  if (hasEnter && text.length > 60) return // 붙여 넣기 — Enter 를 삼킨다
  if (hasEnter) { const code = buf; buf = ''; submit(code) }
})
