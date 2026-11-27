// `src/test/render` registers its own `afterEach(cleanup)` on import; every
// suite in this folder imports this module so that holds for each of them.
import "../../../test/render";
