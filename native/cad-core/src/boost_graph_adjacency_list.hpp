#pragma once

// Standalone shim for FreeCAD's boost_graph_adjacency_list.hpp wrapper.
// Upstream wraps <boost/graph/adjacency_list.hpp> for version quirks;
// PlaneGCS only needs adjacency_list<vecS, vecS, undirectedS>.
#include <boost/graph/adjacency_list.hpp>
