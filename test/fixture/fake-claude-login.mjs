// 시험용 `claude setup-token` — 주소를 내고, 번호 한 줄을 받으면 오래 가는 열쇠 모양을 낸다(진짜 Claude 를 부르지 않는다)
import readline from 'node:readline'
process.stdout.write('Browser didn\'t open? Use the url below to sign in:\n\nhttps://claude.ai/oauth/authorize?code=true&state=test-7f3a\n\nPaste code here if prompted > ')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (code) => {
  if (code.trim() === 'bad') { process.stdout.write('\nOAuth error: invalid code\n'); process.exit(1) }
  process.stdout.write('\n✓ Long-lived authentication token created successfully!\n\nYour OAuth token (valid for 1 year):\n\nsk-ant-oat01-TESTTOKEN0123456789abcdefABCDEF\n')
  process.exit(0)
})
