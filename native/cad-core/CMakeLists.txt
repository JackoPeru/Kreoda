cmake_minimum_required(VERSION 3.28)

project(intentcad-core VERSION 0.1.0 LANGUAGES CXX)

# §2.1: C++17 baseline (OCCT 8.0.x establishes it). MSVC / Clang / GCC.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(WITH_OCCT "Link OpenCASCADE 8.0.1 (full B-Rep kernel)" ON)
option(WITH_FLATBUFFERS "Link FlatBuffers for IPC codegen" ON)
option(BUILD_TESTING "Build GoogleTest suite" ON)

# Prefer shared OCCT libs for LGPL compliance (§2.2).
set(BUILD_SHARED_LIBS ON)

if(WITH_FLATBUFFERS)
  find_package(flatbuffers CONFIG QUIET)
endif()
find_package(lib3mf CONFIG QUIET)

# Sketch constraint solver deps (header-only): Eigen3 + Boost graph/math.
find_package(Eigen3 CONFIG QUIET)
find_package(Boost CONFIG QUIET COMPONENTS headers)
if(NOT Boost_FOUND)
  # Header-only fallback: point at the vcpkg include tree directly.
  find_path(BOOST_CONNECTED_COMPONENTS_HPP
    NAMES boost/graph/connected_components.hpp
    PATHS "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/include"
    NO_DEFAULT_PATH)
  if(BOOST_CONNECTED_COMPONENTS_HPP)
    set(Boost_FOUND TRUE)
  endif()
endif()

if(WITH_OCCT)
  # vcpkg provides the OpenCASCADE config (8.0.1 per vcpkg.json pin).
  find_package(OpenCASCADE CONFIG QUIET)
  if(OpenCASCADE_FOUND)
    message(STATUS "OCCT found: ${OpenCASCADE_VERSION}")
  else()
    message(WARNING "OCCT not found — building STUB core (box mesh generator). "
      "Configure with vcpkg toolchain to get the real kernel: "
      "cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake")
  endif()
endif()

# .icad ZIP container (§30) via minizip-ng; optional until vcpkg provides it.
find_package(minizip-ng CONFIG QUIET)
if(NOT minizip-ng_FOUND)
  find_package(minizip CONFIG QUIET)
endif()
set(INTENTCAD_HAVE_MINIZIP OFF)
if(minizip-ng_FOUND OR minizip_FOUND)
  set(INTENTCAD_HAVE_MINIZIP ON)
endif()

set(CORE_SOURCES
  src/main/main.cpp
  src/protocol/framing.cpp
  src/protocol/dispatcher.cpp
  src/protocol/mesh_fb.cpp
  src/document/document_store.cpp
  src/exchange/gltf_exchange.cpp
  src/exchange/obj_exchange.cpp
  src/exchange/sew.cpp
  src/exchange/step_exchange.cpp
  src/exchange/stl_exchange.cpp
  src/exchange/threemf_exchange.cpp
  src/model/feature_graph.cpp
  src/model/shapes.cpp
  src/model/commit.cpp
  src/features/primitives/primitives.cpp
  src/features/rebuild.cpp
  src/features/sketch/sketch_store.cpp
  src/features/sketch/sketch_face.cpp
  src/features/sketch/sketch_json.cpp
  src/features/sketch/sketch_commands.cpp
  src/features/extrusion/extrude.cpp
  src/features/revolve/revolve.cpp
  src/features/booleans/boolean.cpp
  src/features/hole/hole.cpp
  src/features/fillet/fillet.cpp
  src/topology/persistent_refs.cpp
  src/topology/face_roles.cpp
  src/tessellation/box_tessellator.cpp
  src/tessellation/mesh.cpp
  src/persistence/ocaf_store.cpp
  src/persistence/ocaf_live.cpp
  src/persistence/icad_zip.cpp
  src/validation/validate.cpp
  src/diagnostics/log.cpp
)

# PlaneGCS availability must be decided BEFORE use (was used before set).
if(Eigen3_FOUND AND Boost_FOUND)
  set(HAVE_PLANEGCS ON)
else()
  set(HAVE_PLANEGCS OFF)
  message(STATUS "Eigen3/Boost missing — sketch solver disabled (UI sketch work unaffected in stub protocol tests).")
endif()

if(HAVE_PLANEGCS)
  list(APPEND CORE_SOURCES src/constraints/planegcs_solver.cpp)
else()
  list(APPEND CORE_SOURCES src/constraints/solver_stub.cpp)
endif()

# PlaneGCS as its own isolated component (§5.1): replaceable backend.
# Static lib (not installed): isolation boundary is the target + ISketchSolver.
set(PLANEGCS_SOURCES
  src/constraints/planegcs/GCS.cpp
  src/constraints/planegcs/Geo.cpp
  src/constraints/planegcs/Constraints.cpp
  src/constraints/planegcs/SubSystem.cpp
  src/constraints/planegcs/qp_eq.cpp
)

if(HAVE_PLANEGCS)
  add_library(planegcs STATIC ${PLANEGCS_SOURCES})
  # Upstream PlaneGCS uses C++20 (std::numbers::pi); the core stays C++17
  # per the OCCT 8.0 baseline (§2.1). Same MSVC ABI — safe to link.
  set_target_properties(planegcs PROPERTIES CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON CXX_EXTENSIONS OFF)
  target_include_directories(planegcs PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src/constraints
    ${CMAKE_CURRENT_SOURCE_DIR}/src
  )
  target_link_libraries(planegcs PUBLIC Eigen3::Eigen)
  if(TARGET Boost::headers)
    target_link_libraries(planegcs PUBLIC Boost::headers)
  elseif(BOOST_CONNECTED_COMPONENTS_HPP)
    get_filename_component(BOOST_INCLUDE_DIR "${BOOST_CONNECTED_COMPONENTS_HPP}" DIRECTORY)
    get_filename_component(BOOST_INCLUDE_DIR "${BOOST_INCLUDE_DIR}" DIRECTORY)
    target_include_directories(planegcs PUBLIC ${BOOST_INCLUDE_DIR})
  endif()
  # PlaneGCS is warning-noisy legacy code; keep our /W4 for first-party TUs.
  if(MSVC)
    target_compile_options(planegcs PRIVATE /W1)
  else()
    target_compile_options(planegcs PRIVATE -w)
  endif()
endif()

add_executable(intentcad-core ${CORE_SOURCES})

target_include_directories(intentcad-core PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

if(HAVE_PLANEGCS)
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_PLANEGCS=1)
  target_link_libraries(intentcad-core PRIVATE planegcs)
else()
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_PLANEGCS=0)
endif()

if(OpenCASCADE_FOUND)
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_OCCT=1)
  target_link_libraries(intentcad-core PRIVATE
    TKernel TKMath TKCDF TKLCAF TKCAF TKBin TKBinL TKBinXCAF TKXCAF
    TKBRep TKTopAlgo TKGeomAlgo TKGeomBase TKG3d TKG2d TKPrim TKBO
    TKMesh TKShHealing TKXSBase TKFillet TKDE TKDESTEP TKDESTL TKDEOBJ
  )
else()
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_OCCT=0)
endif()

if(INTENTCAD_HAVE_MINIZIP)
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_MINIZIP=1)
  if(TARGET MINIZIP::minizip-ng)
    target_link_libraries(intentcad-core PRIVATE MINIZIP::minizip-ng)
  elseif(TARGET minizip-ng::minizip-ng)
    target_link_libraries(intentcad-core PRIVATE minizip-ng::minizip-ng)
  elseif(TARGET unofficial::minizip::minizip)
    target_link_libraries(intentcad-core PRIVATE unofficial::minizip::minizip)
  endif()
else()
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_MINIZIP=0)
endif()

if(flatbuffers_FOUND)
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_FLATBUFFERS=1)
  target_link_libraries(intentcad-core PRIVATE flatbuffers::flatbuffers)
endif()

# 3MF exchange (Phase 8 §61): lib3mf C++ API + shared lib via vcpkg.
if(lib3mf_FOUND)
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_LIB3MF=1)
  target_link_libraries(intentcad-core PRIVATE lib3mf::lib3mf)
else()
  target_compile_definitions(intentcad-core PRIVATE INTENTCAD_WITH_LIB3MF=0)
endif()

# Phase 8 flatc codegen (§61): regenerate C++ bindings from the canonical
# schema whenever it changes. TS bindings come from the same schema via
# `pnpm --filter @intentcad/protocol codegen` (same flatc, C++ + TS together).
# Transport stays JSON until the migration slice — this only keeps the
# generated header fresh; test_codegen.cpp guards value parity either way.
set(CAD_PROTOCOL_FBS "${CMAKE_CURRENT_SOURCE_DIR}/../../schemas/cad_protocol.fbs")
set(CAD_PROTOCOL_GENERATED "${CMAKE_CURRENT_SOURCE_DIR}/src/protocol/generated/cad_protocol_generated.h")
if(EXISTS "${CAD_PROTOCOL_FBS}")
  if(NOT FLATC_EXECUTABLE)
    # Manifest-mode vcpkg layouts differ (per-config build dir vs manifest
    # root); probe both before falling back to PATH.
    foreach(_flatc_cand
        "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/flatbuffers/flatc${CMAKE_EXECUTABLE_SUFFIX}"
        "${CMAKE_CURRENT_SOURCE_DIR}/vcpkg_installed/${VCPKG_TARGET_TRIPLET}/tools/flatbuffers/flatc${CMAKE_EXECUTABLE_SUFFIX}"
        "${CMAKE_CURRENT_SOURCE_DIR}/vcpkg_installed/x64-windows/tools/flatbuffers/flatc${CMAKE_EXECUTABLE_SUFFIX}")
      if(EXISTS "${_flatc_cand}")
        set(FLATC_EXECUTABLE "${_flatc_cand}")
        break()
      endif()
    endforeach()
    if(NOT FLATC_EXECUTABLE)
      find_program(FLATC_EXECUTABLE flatc)
    endif()
  endif()
  if(FLATC_EXECUTABLE)
    add_custom_command(
      OUTPUT "${CAD_PROTOCOL_GENERATED}"
      COMMAND "${FLATC_EXECUTABLE}" --cpp -o "${CMAKE_CURRENT_SOURCE_DIR}/src/protocol/generated" "${CAD_PROTOCOL_FBS}"
      DEPENDS "${CAD_PROTOCOL_FBS}"
      COMMENT "flatc: regenerating cad_protocol bindings"
      VERBATIM)
    add_custom_target(intentcad-protocol-codegen DEPENDS "${CAD_PROTOCOL_GENERATED}")
    add_dependencies(intentcad-core intentcad-protocol-codegen)
  else()
    message(STATUS "flatc not found — using committed cad_protocol_generated.h (run pnpm codegen to refresh)")
  endif()
endif()

# Warnings as errors on CI-worthy paths (MSVC / GCC / Clang).
if(MSVC)
  target_compile_options(intentcad-core PRIVATE /W4 /permissive-)
else()
  target_compile_options(intentcad-core PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(BUILD_TESTING)
  include(CTest)
  find_package(GTest CONFIG QUIET)
  if(GTest_FOUND OR EXISTS "/usr/src/googletest")
    add_subdirectory(tests)
  else()
    message(STATUS "GTest not found — C++ tests skipped (npm/vitest still run).")
  endif()
endif()

install(TARGETS intentcad-core RUNTIME DESTINATION bin)
