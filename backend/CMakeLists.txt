cmake_minimum_required(VERSION 3.20)
project(secure-p2p-chat-backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ─── Dependencies (via find_package or FetchContent) ─────────────────────────

include(FetchContent)

# nlohmann/json
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
)
FetchContent_MakeAvailable(json)

# spdlog
FetchContent_Declare(
    spdlog
    GIT_REPOSITORY https://github.com/gabime/spdlog.git
    GIT_TAG        v1.13.0
)
FetchContent_MakeAvailable(spdlog)

# ASIO (standalone, header-only)
FetchContent_Declare(
    asio
    GIT_REPOSITORY https://github.com/chriskohlhoff/asio.git
    GIT_TAG        asio-1-30-2
)
FetchContent_MakeAvailable(asio)
add_library(asio INTERFACE)
target_include_directories(asio INTERFACE ${asio_SOURCE_DIR}/asio/include)
target_compile_definitions(asio INTERFACE ASIO_STANDALONE)

# ─── System libraries (must be installed on your system) ─────────────────────
# libsodium  – https://doc.libsodium.org/installation
# libcurl    – https://curl.se/libcurl/
# SQLite3    – https://www.sqlite.org/download.html

find_package(PkgConfig QUIET)

# libsodium
if(PkgConfig_FOUND)
    pkg_check_modules(SODIUM REQUIRED libsodium)
else()
    find_library(SODIUM_LIBRARIES NAMES sodium)
    find_path(SODIUM_INCLUDE_DIRS sodium.h)
    if(NOT SODIUM_LIBRARIES OR NOT SODIUM_INCLUDE_DIRS)
        message(FATAL_ERROR "libsodium not found. Install it or set SODIUM_ROOT.")
    endif()
endif()

# libcurl
find_package(CURL REQUIRED)

# SQLite3
find_package(SQLite3 REQUIRED)

# ─── Sources ─────────────────────────────────────────────────────────────────

set(SOURCES
    src/main.cpp
    src/node/node.cpp
    src/crypto/crypto_manager.cpp
    src/network/peer_server.cpp
    src/network/peer_client.cpp
    src/supabase/supabase_client.cpp
    src/api/local_api.cpp
)

add_executable(${PROJECT_NAME} ${SOURCES})

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${SODIUM_INCLUDE_DIRS}
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    asio
    ${SODIUM_LIBRARIES}
    CURL::libcurl
    SQLite::SQLite3
)

# ─── Platform-specific ───────────────────────────────────────────────────────
if(WIN32)
    target_link_libraries(${PROJECT_NAME} PRIVATE ws2_32 wsock32)
endif()
