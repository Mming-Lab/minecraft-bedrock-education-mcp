# Current MCP tool surface

Read statically from `src/tools` — the classes cannot be imported because
`BaseTool` depends on socket-be, which is not installed.

**20 tools.**

| tool | actions | parameters | description length |
|---|---|---|---|
| `agent` | 15 | 11 (action, direction, distance, x, y, z, slot, item_id, amount, data, steps) | 344 |
| `blocks` | 7 | 10 (action, x, y, z, x2, y2, z2, block_id, mode, steps) | 363 |
| `build_bezier` | 1 | 11 (action, startX, startY, startZ, endX, endY, endZ, controlPoints, material, segments, adaptive) | 379 |
| `build_cube` | 1 | 10 (action, x1, y1, z1, x2, y2, z2, material, hollow, direction) | 217 |
| `build_cylinder` | 1 | 9 (action, centerX, centerY, centerZ, radius, height, material, hollow, axis) | 123 |
| `build_ellipsoid` | 1 | 9 (action, centerX, centerY, centerZ, radiusX, radiusY, radiusZ, material, hollow) | 236 |
| `build_helix` | 1 | 12 (action, centerX, centerY, centerZ, radius, height, turns, material, clockwise, axis, direction, chirality) | 164 |
| `build_hyperboloid` | 1 | 10 (action, centerX, centerY, centerZ, baseRadius, waistRadius, height, material, hollow, axis) | 139 |
| `build_line` | 1 | 8 (action, x1, y1, z1, x2, y2, z2, material) | 242 |
| `build_paraboloid` | 1 | 10 (action, centerX, centerY, centerZ, radius, height, material, hollow, axis, direction) | 130 |
| `build_rotate` | 1 | 13 (action, sourceCorner1X, sourceCorner1Y, sourceCorner1Z, sourceCorner2X, sourceCorner2Y, sourceCorner2Z, originX, originY, originZ, axis, angle, material) | 233 |
| `build_sphere` | 1 | 8 (action, centerX, centerY, centerZ, radius, material, hollow, direction) | 229 |
| `build_torus` | 1 | 9 (action, centerX, centerY, centerZ, majorRadius, minorRadius, material, hollow, axis) | 141 |
| `build_transform` | 1 | 12 (action, sourceCorner1X, sourceCorner1Y, sourceCorner1Z, sourceCorner2X, sourceCorner2Y, sourceCorner2Z, targetX, targetY, targetZ, transformation, material) | 236 |
| `camera` | 7 | 19 (action, x, y, z, look_at_x, look_at_y, look_at_z, entity, pitch, yaw, duration, easing, fade_in, fade_hold, fade_out, color, mode, auto_clear, shots) | 329 |
| `minecraft_wiki` | 5 | 7 (action, query, page_title, title, section, focus, steps) | 391 |
| `player` | 13 | 14 (action, player_name, message, item_id, amount, gamemode, levels, ability, ability_value, tag, can_destroy, can_place_on, keep_on_death, steps) | 390 |
| `sequence` | - | 2 (steps, description) | 418 |
| `system` | - | 15 (category, action, objective_id, display_name, player_name, score, display_slot, sort_order, title, subtitle, message, fade_in, stay, fade_out, steps) | 329 |
| `world` | 11 | 8 (action, time, weather, duration, message, target, command, steps) | 369 |

## Actions named in a description but absent from the enum

The description is what the model reads when choosing a call. Where it advertises
an action the enum does not contain, the model will build calls that cannot succeed.

| tool | advertised but missing | actual enum |
|---|---|---|
| `world` | `set_difficulty`, `set_spawn`, `query_info` | `set_time`, `get_time`, `get_day`, `set_weather`, `get_weather`, `get_players`, `get_world_info`, `send_message`, `run_command`, `get_connection_info`, `sequence` |

## Actions that exist but the description never mentions

The reverse gap. An action the description does not name is one the model has no
reason to try, so it is effectively unavailable however well it is implemented.

| tool | mentioned | unmentioned |
|---|---|---|
| `agent` | 8/15 | `inspect_block`, `detect_block`, `get_position`, `drop_item`, `drop_all`, `set_item_in_slot`, `sequence` |
| `blocks` | 4/7 | `query_item_data`, `query_mob_data`, `sequence` |
| `build_bezier` | 0/1 | `build` |
| `build_cube` | 0/1 | `build` |
| `build_cylinder` | 0/1 | `build` |
| `build_ellipsoid` | 0/1 | `build` |
| `build_helix` | 0/1 | `build` |
| `build_hyperboloid` | 0/1 | `build` |
| `build_paraboloid` | 0/1 | `build` |
| `build_sphere` | 0/1 | `build` |
| `build_torus` | 0/1 | `build` |
| `minecraft_wiki` | 2/5 | `get_page`, `get_page_summary`, `get_section` |
| `player` | 10/13 | `get_location`, `get_abilities`, `get_tags` |
| `world` | 2/11 | `get_time`, `get_day`, `get_weather`, `get_players`, `get_world_info`, `send_message`, `run_command`, `get_connection_info`, `sequence` |

## Cross-tool references in `sequence`

`sequence` advertises actions belonging to other tools. These are checked against
the referenced tool's own enum.

| referenced tool | claimed by `sequence` | absent from that tool |
|---|---|---|
| `player` | `teleport`, `move`, `say` | `teleport`, `move`, `say` |
| `camera` | `shot`, `video` | `shot`, `video` |
| `blocks` | `setblock`, `fill` | `setblock`, `fill` |
| `world` | `time`, `weather` | `time`, `weather` |

## Array parameters declared without `items`

`schema-converter.ts` turns these into `z.array(z.any())`, so nothing inside them
is validated — enum, minimum and maximum on the step fields all stop applying.

| tool | parameter |
|---|---|
| `agent` | `steps` |
| `blocks` | `steps` |
| `camera` | `shots` |
| `player` | `can_destroy` |
| `player` | `can_place_on` |
| `system` | `steps` |
| `world` | `steps` |
