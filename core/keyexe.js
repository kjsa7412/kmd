// 자격 저장소 도우미 실행 파일(Windows) — DPAPI 를 PowerShell 없이 푼다.
//
//   까닭  Claude Code 는 MCP 연결의 headersHelper 를 10초만 기다린다. PowerShell 은 PC 에 따라 켜지는 데만 7초 넘게 걸려
//         열쇠를 내기 전에 잘리고, 헤더 없이 붙은 연결은 OAuth 로 넘어가 「인증 필요」로 굳는다.
//   꼴    C# 한 벌(C# 5 — .NET Framework 의 csc · PowerShell 5.1 Add-Type 이 둘 다 읽는다)을 이 PC 에서 한 번 만들어 둔다
//          kmd-key.exe p        표준 입력 base64 → DPAPI(현재 사용자)로 감싼 base64
//          kmd-key.exe u        표준 입력 base64(감싼 것) → 푼 base64
//          kmd-key.exe <주소>   그 서버의 기기 열쇠 파일을 풀어 {"Authorization":"Bearer …"} 한 줄(팀 연결의 headersHelper)
//   파일  열쇠 파일 이름 · 자리는 core/keystore.js · core/teamkit.js 와 같다: sha256('device:' + origin) 앞 24 + '.dpapi'
//          %USERPROFILE%\.kmd\keys 먼저 · 없으면 예전 자리 %APPDATA%\kmd\keys

import crypto from 'node:crypto'

export const KEY_EXE_CS = `using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;

static class KmdKey {
  // 환경변수 먼저 — PowerShell 도우미($env:USERPROFILE) · node(os.homedir) 와 같은 자리를 본다
  static string Dir(string env, Environment.SpecialFolder sf) {
    string v = Environment.GetEnvironmentVariable(env);
    return string.IsNullOrEmpty(v) ? Environment.GetFolderPath(sf) : v;
  }
  static int Main(string[] a) {
    try {
      if (a.Length == 1 && (a[0] == "p" || a[0] == "u")) {
        byte[] b = Convert.FromBase64String(Console.In.ReadToEnd().Trim());
        byte[] r = a[0] == "p" ? ProtectedData.Protect(b, null, DataProtectionScope.CurrentUser) : ProtectedData.Unprotect(b, null, DataProtectionScope.CurrentUser);
        Console.Out.Write(Convert.ToBase64String(r));
        return 0;
      }
      if (a.Length != 1) throw new Exception("args");
      string o = new Uri(a[0]).GetLeftPart(UriPartial.Authority);
      StringBuilder h = new StringBuilder();
      using (SHA256 sha = SHA256.Create()) { foreach (byte x in sha.ComputeHash(Encoding.UTF8.GetBytes("device:" + o))) h.Append(x.ToString("x2")); }
      string n = h.ToString().Substring(0, 24) + ".dpapi";
      string f = Path.Combine(Dir("USERPROFILE", Environment.SpecialFolder.UserProfile), ".kmd", "keys", n);
      if (!File.Exists(f)) f = Path.Combine(Dir("APPDATA", Environment.SpecialFolder.ApplicationData), "kmd", "keys", n);
      string k = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(File.ReadAllText(f).Trim()), null, DataProtectionScope.CurrentUser));
      Console.Out.Write("{\\"Authorization\\":\\"Bearer " + k + "\\"}");
      return 0;
    } catch {
      Console.Error.WriteLine("kmd: no key on this PC. Paste the install line from team screen > Settings > Agent install again");
      return 1;
    }
  }
}
`

// 판 — 글이 바뀌면 새 이름으로 다시 만든다(이미 만든 것은 그대로 쓴다)
export const KEY_EXE_VER = crypto.createHash('sha256').update(KEY_EXE_CS).digest('hex').slice(0, 8)
