/** Quyền hiệu lực (V1.1) = quyền của các vai trò ∪ quyền cấp thêm − quyền bị thu hồi. Thu hồi thắng cấp thêm của vai trò. */
export function effectivePermissions(rolePermissions: Iterable<string>, overrides: { code: string; granted: boolean }[]): Set<string> {
  const out = new Set(rolePermissions);
  for (const o of overrides) {
    if (o.granted) out.add(o.code);
    else out.delete(o.code);
  }
  return out;
}
