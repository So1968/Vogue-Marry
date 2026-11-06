import { spawnSync } from "node:child_process";

// Le mode POSIX 0600 ne constitue pas un contrôle d'accès sous Windows.
// Le chemin passe par une variable de processus : jamais interpolé dans PowerShell.
const PRIVATE_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$p = [Environment]::GetEnvironmentVariable('VOGUE_PRIVATE_PATH')
$directory = [Environment]::GetEnvironmentVariable('VOGUE_PRIVATE_DIRECTORY') -eq '1'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
if ($directory) {
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
} else {
  $acl = [System.Security.AccessControl.FileSecurity]::new()
}
$acl.SetOwner($user)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($user, $system)) {
  if ($directory) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  } else {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow')
  }
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $p -AclObject $acl
`;

export function protectWindowsPrivatePath(target, directory = false, run = spawnSync) {
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PRIVATE_ACL_SCRIPT], {
    env: { ...process.env, VOGUE_PRIVATE_PATH: target, VOGUE_PRIVATE_DIRECTORY: directory ? "1" : "0" },
    encoding: "utf8", windowsHide: true, timeout: 30_000
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.code || result.status || "erreur inconnue")
      .replaceAll(target, "[chemin privé]").replace(/S-\d-(?:\d+-)+\d+/gu, "[SID]").slice(0, 1200);
    throw new Error("Protection Windows des secrets impossible. Vérifier les droits NTFS et la disponibilité de PowerShell. " + detail);
  }
}
