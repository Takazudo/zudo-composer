// The root-entry self-reference shape. `pack` is this package's own exported
// subpath, and the exported module IS the package root, so a pre-graph digest
// that hashed `dirname(entryPath)` hashed the whole host root — `cms/` and
// `.zudo-site-project/` included. This fixture reproduces that drift and
// proves the graph-identified digest fixes it.
export default {
  pack: "self-host-root/pack",
};
