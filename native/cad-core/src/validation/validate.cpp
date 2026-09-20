#include "validate.h"

namespace kreoda {

bool ValidateCommittedShape(double w, double h, double d) {
  return w > 0 && h > 0 && d > 0;
}

}  // namespace kreoda
