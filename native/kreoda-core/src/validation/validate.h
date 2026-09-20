#pragma once
// Geometry validation gate (§41): every commit checks kernel status +
// BRepCheck + null-shape rejection. Never serve a fake mesh on failure.

namespace kreoda {

bool ValidateCommittedShape(double widthMm, double heightMm, double depthMm);

}  // namespace kreoda
