find_package(GTest CONFIG QUIET)
if(NOT GTest_FOUND)
  return()
endif()

add_executable(intentcad-core-tests
  test_box.cpp
  test_codegen.cpp
  test_framing.cpp
  test_gltf.cpp
  test_meshcache.cpp
  test_obj.cpp
  test_persistence.cpp
  test_topology.cpp
  test_topology_imports.cpp
  test_graph.cpp
  test_undo.cpp
  test_sketch.cpp
  test_solids.cpp
  test_step.cpp
  test_stl.cpp
  test_threemf.cpp
  ../src/protocol/framing.cpp
  ../src/protocol/dispatcher.cpp
  ../src/protocol/mesh_fb.cpp
  ../src/document/document_store.cpp
  ../src/exchange/gltf_exchange.cpp
  ../src/exchange/obj_exchange.cpp
  ../src/exchange/sew.cpp
  ../src/exchange/step_exchange.cpp
  ../src/exchange/stl_exchange.cpp
  ../src/exchange/threemf_exchange.cpp
  ../src/model/feature_graph.cpp
  ../src/model/shapes.cpp
  ../src/model/commit.cpp
  ../src/features/primitives/primitives.cpp
  ../src/features/rebuild.cpp
  ../src/features/sketch/sketch_store.cpp
  ../src/features/sketch/sketch_face.cpp
  ../src/features/sketch/sketch_json.cpp
  ../src/features/sketch/sketch_commands.cpp
  ../src/features/extrusion/extrude.cpp
  ../src/features/revolve/revolve.cpp
  ../src/features/booleans/boolean.cpp
  ../src/features/hole/hole.cpp
  ../src/features/fillet/fillet.cpp
  ../src/topology/persistent_refs.cpp
  ../src/topology/face_roles.cpp
  ../src/tessellation/box_tessellator.cpp
  ../src/tessellation/mesh.cpp
  ../src/persistence/ocaf_store.cpp
  ../src/persistence/ocaf_live.cpp
  ../src/persistence/icad_zip.cpp
  ../src/validation/validate.cpp
  ../src/diagnostics/log.cpp
)

if(HAVE_PLANEGCS)
  target_sources(intentcad-core-tests PRIVATE
    test_solver.cpp
    ../src/constraints/planegcs_solver.cpp
  )
  target_link_libraries(intentcad-core-tests PRIVATE planegcs)
  target_compile_definitions(intentcad-core-tests PRIVATE
    INTENTCAD_WITH_PLANEGCS=1)
else()
  target_sources(intentcad-core-tests PRIVATE
    ../src/constraints/solver_stub.cpp
  )
  target_compile_definitions(intentcad-core-tests PRIVATE
    INTENTCAD_WITH_PLANEGCS=0)
endif()

target_include_directories(intentcad-core-tests PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../src
  ${CMAKE_CURRENT_SOURCE_DIR}/../include
)
target_compile_definitions(intentcad-core-tests PRIVATE
  INTENTCAD_WITH_OCCT=$<BOOL:${OpenCASCADE_FOUND}>
  INTENTCAD_WITH_MINIZIP=$<BOOL:${INTENTCAD_HAVE_MINIZIP}>
  INTENTCAD_WITH_FLATBUFFERS=$<BOOL:${flatbuffers_FOUND}>
)
if(flatbuffers_FOUND)
  target_link_libraries(intentcad-core-tests PRIVATE flatbuffers::flatbuffers)
endif()
if(lib3mf_FOUND)
  target_compile_definitions(intentcad-core-tests PRIVATE
    INTENTCAD_WITH_LIB3MF=1)
  target_link_libraries(intentcad-core-tests PRIVATE lib3mf::lib3mf)
else()
  target_compile_definitions(intentcad-core-tests PRIVATE
    INTENTCAD_WITH_LIB3MF=0)
endif()
if(OpenCASCADE_FOUND)
  target_link_libraries(intentcad-core-tests PRIVATE
    TKernel TKMath TKCDF TKLCAF TKCAF TKBin TKBinL TKBinXCAF TKXCAF
    TKBRep TKTopAlgo TKGeomAlgo TKGeomBase TKG3d TKG2d TKPrim TKBO
    TKMesh TKShHealing TKXSBase TKFillet TKDE TKDESTEP TKDESTL TKDEOBJ
  )
endif()
if(TARGET MINIZIP::minizip-ng)
  target_link_libraries(intentcad-core-tests PRIVATE MINIZIP::minizip-ng)
elseif(TARGET minizip-ng::minizip-ng)
  target_link_libraries(intentcad-core-tests PRIVATE minizip-ng::minizip-ng)
elseif(TARGET unofficial::minizip::minizip)
  target_link_libraries(intentcad-core-tests PRIVATE unofficial::minizip::minizip)
endif()
target_link_libraries(intentcad-core-tests PRIVATE GTest::gtest GTest::gtest_main)
if(TARGET intentcad-protocol-codegen)
  add_dependencies(intentcad-core-tests intentcad-protocol-codegen)
endif()

include(GoogleTest)
gtest_discover_tests(intentcad-core-tests)
