// Pure capsule-vs-collider resolution shared by World and unit tests.

export function resolveCylinder(pos, radius, collider) {
  if (pos.y > collider.topY) return false;
  const dx = pos.x - collider.x;
  const dz = pos.z - collider.z;
  const distance = Math.hypot(dx, dz);
  const minimum = collider.r + radius;
  if (distance >= minimum) return false;
  if (distance <= 0.0001) {
    pos.x = collider.x + minimum;
    return true;
  }
  const push = (minimum - distance) / distance;
  pos.x += dx * push;
  pos.z += dz * push;
  return true;
}

export function resolveBox(pos, radius, height, box) {
  if (pos.y > box.max.y || pos.y + height < box.min.y) return false;
  const closestX = Math.max(box.min.x, Math.min(pos.x, box.max.x));
  const closestZ = Math.max(box.min.z, Math.min(pos.z, box.max.z));
  const dx = pos.x - closestX;
  const dz = pos.z - closestZ;
  const distance = Math.hypot(dx, dz);
  if (distance >= radius) return false;

  if (distance > 0.0001) {
    const push = (radius - distance) / distance;
    pos.x += dx * push;
    pos.z += dz * push;
  } else {
    const pushXPos = box.max.x - pos.x;
    const pushXNeg = pos.x - box.min.x;
    const pushZPos = box.max.z - pos.z;
    const pushZNeg = pos.z - box.min.z;
    const minimum = Math.min(pushXPos, pushXNeg, pushZPos, pushZNeg);
    if (minimum === pushXPos) pos.x = box.max.x + radius;
    else if (minimum === pushXNeg) pos.x = box.min.x - radius;
    else if (minimum === pushZPos) pos.z = box.max.z + radius;
    else pos.z = box.min.z - radius;
  }
  return true;
}

export function resolveCapsuleColliders(pos, radius, height, colliders) {
  for (const collider of colliders) {
    if (collider.type === 'cylinder') {
      resolveCylinder(pos, radius, collider);
    } else if (collider.box) {
      resolveBox(pos, radius, height, collider.box);
    }
  }
  return pos;
}

export function ledgeHeight(x, z, fromY, boxes, base = -Infinity) {
  let height = base;
  for (const box of boxes) {
    if (x < box.min.x || x > box.max.x
        || z < box.min.z || z > box.max.z) continue;
    if (box.max.y > height && box.max.y <= fromY + 0.35) {
      height = box.max.y;
    }
  }
  return height;
}
