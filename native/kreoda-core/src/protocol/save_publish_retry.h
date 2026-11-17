#pragma once

namespace kreoda::protocol::save_publish_retry {

enum class TargetState { NonRetryable, DeleteShareLocked, DeleteAvailable };
enum class Decision { Stop, RetryNow, Wait };

inline Decision Decide(TargetState state,
                       bool& retriedWithDeleteAvailable) noexcept {
  switch (state) {
    case TargetState::NonRetryable:
      return Decision::Stop;
    case TargetState::DeleteShareLocked:
      retriedWithDeleteAvailable = false;
      return Decision::Wait;
    case TargetState::DeleteAvailable:
      if (retriedWithDeleteAvailable) return Decision::Stop;
      retriedWithDeleteAvailable = true;
      return Decision::RetryNow;
  }
  return Decision::Stop;
}

}  // namespace kreoda::protocol::save_publish_retry
