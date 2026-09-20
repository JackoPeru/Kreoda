#include "validate.h"

namespace intentcad {

bool ValidateCommittedShape(double w, double h, double d) {
  return w > 0 && h > 0 && d > 0;
}

}  // namespace intentcad
