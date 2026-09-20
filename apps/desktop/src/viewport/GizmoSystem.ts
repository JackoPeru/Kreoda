/** Manipulator handles bound to feature parameters (§68). Dragging edits the
 *  source parameter and recomputes downstream — never raw vertices (§17). */
export interface Manipulator {
  id: string;
  parameter: string;
}
