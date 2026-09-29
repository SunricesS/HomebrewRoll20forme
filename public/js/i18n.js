// ============================================================
// WebDND — Internationalization (i18n) Module
// English (Default) & Turkish Language Support
// ============================================================

(function () {
  'use strict';

  const STORAGE_KEY = 'dnd_language';
  const DEFAULT_LANG = 'en';

  const translations = {
    en: {
      // General / Common
      app_title: 'DnD Desktop',
      login: 'Log In',
      back: 'Back',
      cancel: 'Cancel',
      close: 'Close',
      save: 'Save',
      saved: 'Saved',
      apply: 'Apply',
      delete: 'Delete',
      edit: 'Edit',
      create: 'Create',
      select: 'Select',
      refresh: 'Refresh',
      clear: 'Clear',
      search: 'Search',
      active: 'Active',
      connecting: 'Connecting...',
      connected: 'Connected!',
      turn: 'Turn',
      round: 'Round',
      character: 'Character',
      loading: 'Loading...',
      total: 'Total: ',
      copied_to_clipboard: 'URL Copied to Clipboard!',
      url_copy_manual: 'Copy the URL manually:',
      url_copy_failed: 'Could not copy: ',

      // Page Titles
      page_title_login: 'DnD Desktop - Login',
      page_title_game: 'DnD Desktop - Game',
      page_title_gallery: 'System Gallery - DnD Desktop',

      // Login Screen
      dm_login: 'DM Login',
      player_login: 'Player Login',
      select_profile: 'Select Profile',
      loading_profiles: 'Loading profiles...',
      no_profiles_found: 'No profiles found.',
      fetch_profiles_error: 'Failed to fetch profiles!',
      select_character: 'Select Your Character',
      loading_characters: 'Loading characters...',
      no_characters_for_profile: 'No characters found for this profile. Please create a new one.',
      create_new_character: 'Create New Character',
      create_character: 'Create Character',
      char_name_label: 'Character Name:',
      max_hp_label: 'Maximum HP:',
      avatar_url_label: 'Avatar URL (Optional):',
      create_and_continue: 'Create and Continue',
      alert_select_profile: 'Please select a profile first!',
      alert_name_empty: 'Character name cannot be empty!',
      alert_char_error: 'Error creating character: ',
      saving_progress: 'Saving...',
      unnamed_user: 'Unnamed User',

      // Gallery Screen
      gallery_saved_images: 'Saved Images',
      search_image_placeholder: 'Search by image name...',
      loading_images: 'Loading images...',
      error_loading_images: 'Error loading images!',
      no_images_yet: 'No images added yet.',
      unnamed_image: 'Unnamed',

      // Map Drawing Toolbar
      draw_toolbar_title: 'Drawing & Shape Tools',
      tool_pan: 'Pan',
      tool_pan_title: 'Hand Tool / Pan (H) — Move freely around the map',
      tool_pen_title: 'Freehand Pen (P)',
      tool_line_title: 'Straight Line (L)',
      tool_arrow_title: 'Direction Arrow (A) — Movement/Target indicator',
      tool_rect_title: 'Rectangle (R)',
      tool_circle_title: 'Circle (C)',
      tool_eraser_title: 'Eraser (E) — Erase drawings',
      tool_settings_title: 'Toggle Settings',
      draw_thickness_label: 'Thickness:',
      size_thin: 'Thin',
      size_medium: 'Medium',
      size_thick: 'Thick',
      size_very_thick: 'Very Thick',
      precise_size_title: 'Precise Size Adjustment (2px - 100px)',
      draw_color_label: 'Color:',
      color_red: 'Red',
      color_blue: 'Blue',
      color_green: 'Green',
      color_yellow: 'Yellow',
      color_purple: 'Purple',
      color_white: 'White',
      color_black: 'Black',
      color_custom_title: 'Custom Color Selection',
      draw_fill_label: 'Fill',
      draw_fill_title: 'Fill shapes with semi-transparent color',
      draw_undo: '↩️ Undo',
      draw_undo_title: 'Undo (Ctrl+Z)',
      draw_clear_mine: '🗑️ Clear',
      draw_clear_mine_title: 'Clear My Drawings',
      confirm_clear_mine: 'Are you sure you want to clear your drawings?',
      confirm_clear_all: 'Are you sure you want to clear ALL drawings on the map?',

      // Zoom Controls
      zoom_in_title: 'Zoom In (Wheel Forward / +)',
      zoom_reset_title: 'Default Size (100%) — Click to reset',
      zoom_out_title: 'Zoom Out (Wheel Backward / -)',
      zoom_fit_title: 'Fit Map to Screen (F)',

      // Combat Bar & Hotbar
      combat_round_display: 'Round {n}',
      combat_round_title: 'Current Round',
      combat_status_title: '✨ Status Effects Panel',
      combat_prev_title: 'Previous Turn',
      combat_next_title: 'Next Turn (Space / N)',
      combat_reroll_title: 'Reroll Initiative',
      combat_close_title: 'Close Combat Mode',
      combat_mode_btn: 'Combat Mode',
      combat_mode_btn_title: 'Toggle Combat Mode (Shortcut: C)',
      combat_btn_active: 'Active',
      hotbar_portrait_title: 'Active Turn Character',
      hotbar_active_turn: '⚔️ Active Turn',
      hotbar_open_panel: 'Attack Panel',
      hotbar_open_panel_title: '⚔️ Open / Focus Attack Panel',
      combat_started_log: '⚔️ Combat Mode Started! Initiative dice rolled.',
      combat_ended_log: '🏳️ Combat Mode Ended.',

      // Area Damage (AoE)
      aoe_floating_btn: 'Area Damage',
      aoe_floating_btn_title: '💥 Area Damage (AoE) — Select circular area on map to deal mass damage',
      aoe_modal_title: '💥 Apply Area Damage (AoE)',
      aoe_radius_info: 'Selected Area Radius: {r} px (~{feet} ft)',
      aoe_targets_count: '{count} Targets Covered',
      aoe_targets_section: 'Affected Targets:',
      aoe_exempt_hint: '(Uncheck to exempt)',
      aoe_damage_input_label: 'Damage Amount to Apply:',
      aoe_damage_placeholder: 'e.g.: 25',
      aoe_reselect_btn: '🔄 Reselect',
      aoe_submit_btn: '🔥 Apply Damage',
      aoe_combat_only_warning: '⚠️ Area damage can only be used when Combat Mode is active.',
      aoe_mode_hint: '🎯 Area Damage Mode: Click and drag from center to set radius. [Cancel: ESC]',
      aoe_no_targets_alert: 'At least one target must be selected to apply damage.',
      aoe_damage_done_log: '💥 Area Damage Applied: {dmg} damage dealt to {count} targets.',

      // Control Panel
      control_panel_title: 'Control Panel',
      mode_gunes: '☀️ Sun',
      mode_gunes_title: 'Sun Mode (Default Experience)',
      mode_kenan: '🌑 Kenan',
      mode_kenan_title: 'Kenan Mode (Darkness System & Turn Info)',
      kenan_turn_idle: 'When combat mode starts, details of the active warrior appear here.',
      status_label: 'Status:',
      logs_waiting: 'Waiting for room...',
      dm_login_log: 'Logged in as Dungeon Master.',
      player_login_log: 'Logged in as {name}.',
      player_joined_log: '{name} joined the room.',
      player_disconnected_log: '{name} disconnected.',
      map_saved_manual: 'Map saved manually.',
      dice_rolled_log: '<span style="font-weight: bold;">{name}</span> rolled d{sides}: <strong>{result}</strong>',
      dice_rolled_crit_success: '<span style="font-weight: bold;">{name}</span> rolled d20: <strong style="color: #2ecc71;">20 (Critical Success!)</strong>',
      dice_rolled_crit_fail: '<span style="font-weight: bold;">{name}</span> rolled d20: <strong style="color: #e74c3c;">1 (Critical Failure!)</strong>',

      // DM Tools
      dm_tools_title: 'DM Tools',
      dm_toggle_combat_title: 'Toggle Combat Mode',
      dm_status_toolbox_title: 'Status Effects and Creator',
      dm_batch_assign_title: 'Batch Assign Attacks to Map Tokens',
      dm_save_map_btn: 'Save Map',
      dm_open_gallery_btn: 'Open Gallery',
      dm_create_token_summary: 'Create New Token & Presets',
      token_preset_title: '📜 Saved Presets',
      token_preset_count: '{n} Presets',
      token_preset_select_opt: '— Select Preset (Auto-fill) —',
      token_preset_del_title: 'Delete Selected Preset from Database',
      token_name_label: 'Token / Marker Name:',
      token_name_placeholder: 'e.g.: Goblin Archer or G',
      token_img_label: 'Token Image URL (Optional):',
      token_img_placeholder: 'Enter URL or drag an image...',
      token_color_label: 'Color:',
      token_type_label: 'Token / Entity Type:',
      entity_creature: '👤 Living Creature / NPC',
      entity_explosive: '💣 Explosive Object (Detonates on death)',
      entity_aura: '🔮 Aura / Totem (Emits aura every turn)',
      entity_spawner: '🌀 Spawner / Nest (Spawns enemies every turn)',
      object_function_title: '⚙️ Object Function Settings',
      object_hint_explosion: 'Explosion / Area Effect',
      object_radius_label: 'Effect Radius (px):',
      object_damage_label: 'Damage Amount:',
      object_damage_type_label: 'Damage Type:',
      damage_type_fire: '🔥 Fire',
      damage_type_necrotic: '💀 Necrotic',
      damage_type_poison: '🧪 Poison',
      damage_type_acid: '🧪 Acid',
      damage_type_lightning: '⚡ Lightning',
      damage_type_cold: '❄️ Cold',
      damage_type_force: '🌀 Force',
      damage_type_radiant: '✨ Radiant',
      damage_type_physical: '⚔️ Physical',
      target_filter_label: 'Target Filter:',
      target_filter_all: '👥 Everyone (Friend & Foe)',
      target_filter_players: '🛡️ Players Only',
      target_filter_markers: '👾 Creatures Only',
      apply_status_effect_label: '✨ Apply Status Effect:',
      status_select_opt: '— Select Status Effect (Optional) —',
      destroy_on_detonate: '💥 Remove from map when exploded',
      aura_timing_label: '🔮 Aura Trigger Timing:',
      aura_timing_turn: '⚡ On its turn (Every Turn)',
      aura_timing_round: '🔄 At Round Start',
      spawner_preset_label: '👾 Enemy Template to Spawn:',
      spawner_preset_opt: '— Select Enemy —',
      spawner_count_label: 'Count Per Wave:',
      spawner_radius_label: 'Spawn Radius (px):',
      spawner_timing_label: 'Timing:',
      spawner_destroy_label: '💥 Destroy / Remove from map when HP reaches 0',
      current_hp_label: 'Current HP:',
      max_hp_label: 'Max HP:',
      size_px_label: 'Size (px):',
      ac_label: 'AC:',
      ac_bonus_label: 'AC Bonus:',
      kenan_has_darkness: '🌑 Possesses Darkness',
      kenan_current_darkness: 'Current Darkness:',
      kenan_max_darkness: 'Max Darkness:',
      stat_bonus_hint: 'Stat / Bonus (For Attacks)',
      assign_attacks_to_token: '⚡ Assign Attacks to Token (Optional)',
      attacks_loading: 'Loading attack presets...',
      spawn_to_map_btn: '🚀 Spawn to Map',
      spawn_to_map_title: 'Places token on map with specified properties',
      save_token_preset_btn: '💾 Save as Preset',
      save_token_preset_title: 'Saves HP, stats, name, and image values as a schema to database',
      dm_pen_title: 'DM Pen Color',
      drawing_color_label: 'Drawing Color:',
      update_color_btn: 'Update Color',
      bg_url_label: 'Background URL:',
      bg_url_placeholder: 'Enter URL or drag an image...',
      change_bg_btn: 'Change Background',
      clear_all_drawings_btn: 'Clear All Drawings',
      manage_players_title: 'Manage Players',
      no_connected_players: 'No connected players.',
      selected_player_title: 'Selected Player',
      token_size_label: '📏 Token Size:',
      size_tiny_title: 'Tiny (35px)',
      size_medium_title: 'Medium (Standard 1x1) — 50px',
      size_large_title: 'Large (2x2) — 80px',
      size_huge_title: 'Huge (3x3) — 120px',
      size_gargantuan_title: 'Gargantuan (4x4) — 160px',
      corruption_label: 'Corruption:',
      stats_label: 'Stat / Bonus',
      spell_slots_label: 'Spell Slots',
      active_status_effects_label: '✨ Active Status Effects:',
      clear_all_effects_btn: 'Remove All',
      add_status_effect_opt: '— Add Status Effect —',
      duration_placeholder: 'Rounds (Blank=Permanent)',
      add_effect_btn: '➕ Add',
      assigned_attacks_title: '⚔️ Assigned Attacks (Hotbar Loadout):',
      assigned_attacks_count: '({n} Selected)',
      assigned_attacks_hint: 'Select attacks to display on bottom hotbar (Unlimited)',
      search_attacks_placeholder: 'Search attacks...',
      select_all_btn: 'Select All',
      clear_btn: 'Clear',
      right_click_delete_marker_hint: '* Right-click on a marker to delete it.',

      // Attack Panel
      attack_panel_title: '⚔️ Attack / Damage Panel',
      equipped_preset_heading: '🎯 Equipped Attack Preset',
      btn_presets: '⚙️ Presets',
      free_attack_opt: '— Free Attack (Custom Dice Pool) —',
      stat_chip: 'STR',
      physical_chip: 'Physical',
      half_miss_chip: '🛡️ Miss: ½ Damage',
      status_chip: '✨ Status',
      aoe_chip: '💥 Area Damage',
      attacker_and_target_heading: '🗡️ Attacker & 🎯 Target',
      refresh_list_title: 'Refresh List',
      attacker_select_label: '🗡️ Attacker (stats are used):',
      attacker_select_opt: '— Select Attacker —',
      no_attacker_selected: 'No attacker selected',
      target_select_label: '🎯 Target (checks AC, receives damage):',
      target_clear_title: 'Clear all targets and selection rings',
      target_select_opt: '— Select Target —',
      target_ctrl_hint: '💡 You can multi-select targets with <strong>Ctrl + Left Click</strong> on map tokens.',
      no_target_selected: 'No target selected',
      modifiers_heading: '📊 Modifiers',
      dice_stat_label: 'Dice Stat',
      target_ac_label: 'Target AC',
      manual_bonus_label: 'Manual Bonus',
      attack_count_label: 'Attack Count',
      advantage_label: 'Advantage',
      disadvantage_label: 'Disadvantage',
      damage_channels_heading: '⚔️ Damage Channels',
      phys_main_channel: 'Physical/Main:',
      type_slashing: '⚔️ Slashing',
      type_bludgeoning: '🔨 Bludgeoning',
      type_piercing: '🏹 Piercing',
      type_magic: '✨ Magic',
      no_dice_selected: 'No dice selected',
      roll_this_pool_only: 'Roll Pool',
      clear_pool_title: 'Clear Pool',
      elem1_label: 'Fire/El.1',
      elem2_label: 'Cold/El.2',
      spell_slot_control_title: '✨ Spell Slot Usage',
      required_min_lvl: 'Required: Min Lvl {n}',
      btn_attack: '⚔️ ATTACK',
      btn_heal: '💚 HEAL',
      combat_log_title: 'Combat Log',
      apply_damage_btn: 'Apply Damage',
      apply_heal_btn: 'Apply Heal',

      // Player Info Panel
      my_character_heading: 'My Character',
      customize_token_heading: 'Customize Token',
      token_img_label_player: 'Token Image URL:',
      token_color_label_player: 'Drawing & Token Color:',
      apply_btn_player: 'Apply',
      clear_my_drawings_btn: 'Clear Only My Drawings',
      other_players_heading: 'Other Players',
      no_other_players: 'No other players in the room.',
      char_info_failed: 'Could not load character info.',

      // Modals: Marker Editor
      marker_editor_title: 'Edit Token',
      marker_name_label: 'Marker/Token Name (letter):',
      marker_name_placeholder: 'e.g.: G',
      btn_detonate_now: '💥 Detonate',
      btn_pulse_aura: '🔮 Pulse Aura',
      btn_spawn_wave: '🌀 Spawn Wave (Test)',
      save_marker_edit_btn: 'Save',
      cancel_marker_edit_btn: 'Cancel',

      // Modals: Status Toolbox
      status_toolbox_title: '✨ Status Effects & Creator',
      status_target_token_label: '🎯 Target Token:',
      status_target_hint: '💡 You can also select targets with Ctrl+Click from the map',
      status_target_selected_opt: '-- Selected Targets (On Map) --',
      status_tab_presets: '📜 Presets & Custom Templates',
      status_tab_builder: '🛠️ Custom Effect Builder',
      status_effect_name_label: 'Effect Name:',
      status_name_placeholder: 'e.g.: Flaming Curse, Divine Shield',
      status_icon_label: 'Icon / Emoji:',
      status_rules_heading: 'Modifier Rules:',
      rule_dot: '🔥 Damage Over Turn (DoT)',
      rule_blind: '👁️ Blindness',
      rule_blind_desc: '(Own attacks have disadvantage)',
      rule_paralyzed: '⚡ Paralyzed',
      rule_paralyzed_desc: '(All incoming attacks auto-hit & 2x crit)',
      rule_shelter: '🛡️ Shelter',
      rule_shelter_desc: '(Takes no damage - Invulnerable)',
      rule_prepared: '🎯 Prepared',
      rule_prepared_desc: '(Incoming attacks have disadvantage)',
      rule_unstoppable: '🦏 Unstoppable',
      rule_unstoppable_desc: '(Immune to paralysis)',
      rule_res_title: '🛡️ Damage Resistances (0.5x Damage):',
      res_bludgeoning: '🔨 Bludgeoning Resistance',
      res_slashing: '⚔️ Slashing Resistance',
      res_piercing: '🏹 Piercing Resistance',
      res_magic: '🔮 Magic Resistance',
      rule_vuln_title: '💥 Damage Vulnerabilities (2x Damage):',
      vuln_bludgeoning: '💥🔨 Bludgeoning Vulnerability',
      vuln_slashing: '💥⚔️ Slashing Vulnerability',
      vuln_piercing: '💥🏹 Piercing Vulnerability',
      vuln_magic: '💥✨ Magic Vulnerability',
      duration_label: 'Duration:',
      duration_rounds_label: 'Rounds / Turns',
      duration_permanent_label: 'Permanent / Indefinite',
      btn_save_status_template: '💾 Save Template',
      btn_apply_status_to_target: '⚡ Apply to Target',

      // Modals: Attack Presets
      attack_presets_modal_title: '🎯 Attack Presets Manager',
      atk_tab_list: '📜 Attack Presets Catalog',
      atk_tab_builder: '🛠️ Create New Attack (Builder)',
      atk_search_placeholder: 'Search presets (name, stat, type)...',
      btn_new_preset: '+ Add New Preset',
      builder_mode_new: '✨ Create New Attack Preset (Unlimited)',
      builder_mode_edit: '✏️ Edit Preset: {name}',
      btn_cancel_edit_preset: '✕ Cancel / Back to New Preset',
      atk_name_label: 'Attack / Action Name:',
      atk_name_placeholder: 'e.g.: Divine Smite, Vampiric Strike',
      atk_stat_label: 'Dice Stat (Bonus):',
      atk_nature_label: 'Action Role / Nature:',
      nature_damage: '⚔️ Damage Attack (Direct Dice/Damage)',
      nature_heal: '💚 Healing / Restore HP (Direct Healing)',
      nature_hybrid: '🩸 Hybrid (Deal Damage & Drain/Restore HP)',
      heal_settings_title: '💚 Healing & HP Restore Settings',
      heal_settings_hint: 'Healing and vampiric life drain',
      heal_dice_label: 'Healing Dice:',
      heal_target_label: 'Who receives the healing?',
      heal_target_self: '👤 Caster / Attacker (Self / Lifesteal)',
      heal_target_other: '🎯 Targeted Entity (Ally / Friend)',
      lifesteal_percent_label: '🩸 Lifesteal Percentage (%):',
      lifesteal_percent_desc: '% of dealt damage restored as HP',
      attack_count_builder: 'Attack Count:',
      consumes_spell_slot_check: '✨ Consumes Spell Slot',
      base_spell_lvl_label: 'Base Spell Level (Minimum):',
      base_spell_lvl_desc: 'Requires at least this level slot. Higher slots scale with tabs below.',
      lvl_tab_1: 'Level 1 (Base)',
      lvl_tab_2: 'Level 2',
      lvl_tab_3: 'Level 3',
      lvl_tab_4: 'Level 4',
      copy_base_to_lvl: '📋 Copy Base',
      clear_curr_lvl: '🗑️ Reset Level',
      dice_pools_heading: '🎲 Dice Pools',
      main_damage_pool: 'Main Damage:',
      status_on_hit_label: 'Attach Status Effect on Hit:',
      status_none_opt: '— No Status Effect —',
      half_miss_check: '🛡️ Deal Half Damage on Miss',
      is_aoe_check: '💥 Area Damage (AoE)',
      is_aoe_desc: 'Deals explosion damage to surrounding enemies on hit',
      aoe_radius_label: 'Explosion Radius:',
      meters_unit: 'Meters (m)',
      meters_grid_hint: '(~1 grid square)',
      desc_note_label: 'Description / Note:',
      desc_note_placeholder: 'e.g.: 1d8+2 Slashing + 1d6 Fire. Applies Burn on hit.',
      btn_save_atk_preset: '💾 Save Preset',
      btn_equip_and_save_preset: '⚡ Equip & Save',

      // Modals: Batch Assign Attacks
      batch_attacks_modal_title: '⚡ Batch Assign Attacks to Tokens',
      batch_attacks_intro: 'Assign attack presets to existing or selected tokens (monsters/NPCs) on the map at once.',
      batch_col_tokens_title: '👾 1. Select Target Tokens',
      batch_tokens_count: '{n} Tokens',
      batch_search_tokens: 'Search tokens...',
      batch_col_attacks_title: '⚔️ 2. Select Attacks to Assign',
      batch_attacks_count: '{n} Attacks',
      batch_search_attacks: 'Search attack presets...',
      batch_mode_label: 'Assignment Mode:',
      batch_mode_append: '➕ Append to Existing',
      batch_mode_replace: '🔄 Replace (Overwrite with New)',
      batch_summary_badge: '{tokens} Tokens | {attacks} Attacks selected',
      btn_submit_batch_attacks: '⚡ Assign to Selected Tokens',

      // Modals: AoE Damage
      aoe_modal_title: '💥 Apply Area of Effect Damage (AoE)',
      aoe_radius_info: 'Selected Area Radius: {radius} px',
      aoe_radius_info_full: 'Selected Area: Radius {radius} px (~{feet} ft)',
      aoe_targets_count: '{n} Targets Covered',
      aoe_targets_section: 'Affected Targets:',
      aoe_exempt_hint: '(Uncheck to exempt)',
      aoe_damage_input_label: 'Damage Amount to Apply:',
      aoe_damage_placeholder: 'e.g.: 25',
      aoe_reselect_btn: '🔄 Reselect',
      aoe_submit_btn: '🔥 Apply Damage',
      aoe_active_banner: '🎯 AoE Area Damage Mode: Drag on map to select circle area',
      aoe_combat_only_warn: '⚠️ Area damage can only be used while Combat Mode is active.',
      aoe_start_hint: '🎯 AoE Damage Mode: Click and drag on map to set radius. [Cancel: ESC]',
      aoe_no_targets_found: '⚠️ No tokens or targets found in the selected area.',
      aoe_alert_no_targets: 'At least one target must be selected to apply damage in the area.',
      aoe_detonating_btn: 'Detonating...',

      // Combat Tracker Logs & Display
      combat_round_display: 'Round {n}',
      combat_started_log: '⚔️ Combat Mode Started! Initiative rolls completed.',
      combat_ended_log: '🏳️ Combat Mode Ended.',
      no_attacks_assigned_notice: '⚠️ No attacks assigned to this character (Select from panel).',
      marker_fallback: 'Marker',
      player_fallback: 'Player',
      no_connected_players: 'No connected players.',
      no_other_players: 'No other players in room.',
      player_joined_log: '{name} joined.',
      map_manually_saved_log: 'Map manually saved.',
      confirm_clear_own_drawings: 'Are you sure you want to clear your own drawings?',
      confirm_clear_all_drawings: 'Are you sure you want to clear ALL drawings?',
      dice_rolled_log: '<span style="font-weight: bold;">{name}</span> rolled d{type}: <strong>{result}</strong>',
      dice_rolled_crit_success: '<span style="font-weight: bold;">{name}</span> rolled d20: <strong style="color: #2ecc71;">20 (Critical Success!)</strong>',
      dice_rolled_crit_fail: '<span style="font-weight: bold;">{name}</span> rolled d20: <strong style="color: #e74c3c;">1 (Critical Failure!)</strong>',
      dice_toast_text: '{name}: d{type} 🎲 {result}',
      dice_toast_crit_success: '{name}: 🎲 20 (Critical!)',
      dice_toast_crit_fail: '{name}: 🎲 1 (Critical!)',
      toggle_panel_aria: 'Toggle Panel',
      logged_in_as_dm: 'Logged in as DM.',
      logged_in_as_player: 'Logged in as {name}.',
      unknown_error: 'Unknown error',
      rolled_dice: 'rolled d{type}',

      // Token Context Menu
      token_ctx_size_label: 'Token Size:',
      token_ctx_custom_placeholder: 'Custom px',
      token_ctx_apply: 'Apply',
      token_ctx_edit_char: '⚙️ Edit Character',

      // Alerts & Confirms
      alert_token_not_found: 'Edited token could not be found!',
      alert_select_status: 'Please select a status effect to add!',
      alert_player_not_found: 'Edited player could not be found!',
      alert_images_only: 'Please drag image files only.',
      alert_image_upload_fail: 'Failed to upload image: ',
      alert_image_upload_err: 'An error occurred while uploading image.',
      alert_file_read_err: 'File could not be read!',
      alert_select_target_status: 'Please select at least one TARGET to apply the effect!',
      alert_give_status_name: 'Please give the effect a Name!',
      alert_status_saved: '"{name}" custom status template saved!',
      alert_select_batch_tokens: 'Please select at least one target token.',
      alert_select_batch_attacks: 'Please select at least one attack preset to assign.',
      alert_select_attacker: 'Please select an ATTACKER!',
      alert_select_target: 'Please select at least one TARGET!',
      alert_spell_slot_req: 'This attack requires at least a Level {lvl} spell slot!',
      alert_no_spell_slots: '{name} has no Level {lvl} spell slots left! Please select another level or rest.',
      alert_no_damage_or_spell: 'No damage or spell to apply!',
      alert_give_preset_name: 'Please enter a Name for the attack preset!',
      alert_preset_saved: '"{name}" attack preset saved!',
      confirm_delete_template: 'Are you sure you want to permanently delete the "{name}" template?',
      confirm_delete_preset: 'Are you sure you want to delete the "{name}" preset?',

      // Default Status Preset Names
      preset_burn_name: 'Burn',
      preset_bleed_name: 'Bleeding',
      preset_blind_name: 'Blindness',
      preset_paralyzed_name: 'Paralyzed',
      preset_regen_name: 'Regeneration',
      preset_blessed_name: 'Blessed',
      preset_lifesteal_name: 'Life Drain',

      // Default Attack Preset Names
      atk_preset_flame_sword_name: 'Flame Sword',
      atk_preset_cure_wounds_name: 'Cure Wounds',
      atk_preset_vampiric_touch_name: 'Vampiric Touch'
    },

    tr: {
      // Genel / Ortak
      app_title: 'DnD Masaüstü',
      login: 'Giriş Yap',
      back: 'Geri',
      cancel: 'İptal',
      close: 'Kapat',
      save: 'Kaydet',
      saved: 'Kayıtlı',
      apply: 'Uygula',
      delete: 'Sil',
      edit: 'Düzenle',
      create: 'Oluştur',
      select: 'Seç',
      refresh: 'Yenile',
      clear: 'Temizle',
      search: 'Ara',
      active: 'Aktif',
      connecting: 'Bağlanıyor...',
      connected: 'Bağlandı!',
      turn: 'Tur',
      round: 'Tur',
      character: 'Karakter',
      loading: 'Yükleniyor...',
      total: 'Toplam: ',
      copied_to_clipboard: 'URL Panoya Kopyalandı!',
      url_copy_manual: "URL'yi elle kopyalayın:",
      url_copy_failed: 'Kopyalanamadı: ',

      // Sayfa Başlıkları
      page_title_login: 'DnD Masaüstü - Giriş',
      page_title_game: 'DnD Masaüstü - Oyun',
      page_title_gallery: 'Sistem Galeri - DnD Masaüstü',

      // Giriş Ekranı
      dm_login: 'DM Girişi',
      player_login: 'Kullanıcı Girişi',
      select_profile: 'Profil Seç',
      loading_profiles: 'Profiller yükleniyor...',
      no_profiles_found: 'Hiç profil bulunamadı.',
      fetch_profiles_error: 'Veri çekilemedi!',
      select_character: 'Karakterini Seç',
      loading_characters: 'Karakterler yükleniyor...',
      no_characters_for_profile: 'Bu profile ait karakter bulunamadı. Lütfen yeni bir tane oluşturun.',
      create_new_character: 'Yeni Karakter Oluştur',
      create_character: 'Karakter Oluştur',
      char_name_label: 'Karakter Adı:',
      max_hp_label: 'Maksimum HP:',
      avatar_url_label: 'Avatar URL (Opsiyonel):',
      create_and_continue: 'Oluştur ve Devam Et',
      alert_select_profile: 'Lütfen önce bir profil seçin!',
      alert_name_empty: 'Karakter adı boş olamaz!',
      alert_char_error: 'Karakter oluşturulurken bir hata oluştu: ',
      saving_progress: 'Kaydediliyor...',
      unnamed_user: 'İsimsiz Kullanıcı',

      // Galeri Ekranı
      gallery_saved_images: 'Kayıtlı Resimler',
      search_image_placeholder: 'Resim adıyla ara...',
      loading_images: 'Resimler yükleniyor...',
      error_loading_images: 'Resimler yüklenirken hata oluştu!',
      no_images_yet: 'Henüz eklenmiş resim yok.',
      unnamed_image: 'İsimsiz',

      // Çizim Araç Çubuğu
      draw_toolbar_title: 'Çizim & Şekil Araçları',
      tool_pan: 'Gezin',
      tool_pan_title: 'El Aracı / Kaydırma (H) — Haritada serbestçe gezinin',
      tool_pen_title: 'Serbest Kalem (P)',
      tool_line_title: 'Düz Çizgi (L)',
      tool_arrow_title: 'Yön Oku (A) — Hareket/Hedef gösterme',
      tool_rect_title: 'Dikdörtgen (R)',
      tool_circle_title: 'Daire (C)',
      tool_eraser_title: 'Silgi (E) — İstenilen kısmı sil',
      tool_settings_title: 'Ayarları Aç / Kapat',
      draw_thickness_label: 'Kalınlık:',
      size_thin: 'İnce',
      size_medium: 'Orta',
      size_thick: 'Kalın',
      size_very_thick: 'Çok Kalın',
      precise_size_title: 'Hassas Boyut Ayarı (2px - 100px)',
      draw_color_label: 'Renk:',
      color_red: 'Kırmızı',
      color_blue: 'Mavi',
      color_green: 'Yeşil',
      color_yellow: 'Sarı',
      color_purple: 'Mor',
      color_white: 'Beyaz',
      color_black: 'Siyah',
      color_custom_title: 'Özel Renk Seçimi',
      draw_fill_label: 'Dolgu',
      draw_fill_title: 'Şekillerin içini yarı saydam renkle doldur',
      draw_undo: '↩️ Geri Al',
      draw_undo_title: 'Geri Al (Ctrl+Z)',
      draw_clear_mine: '🗑️ Temizle',
      draw_clear_mine_title: 'Kendi Çizimlerimi Temizle',
      confirm_clear_mine: 'Kendi çizimlerinizi temizlemek istiyor musunuz?',
      confirm_clear_all: 'TÜM çizimleri temizlemek istiyor musunuz?',

      // Yakınlaştırma
      zoom_in_title: 'Yakınlaştır (Tekerlek İleri / +)',
      zoom_reset_title: 'Varsayılan Boyut (%100) — Sıfırlamak için tıklayın',
      zoom_out_title: 'Uzaklaştır (Tekerlek Geri / -)',
      zoom_fit_title: 'Haritayı Ekrana Sığdır (F)',

      // Combat Bar & Hotbar
      combat_round_display: 'Tur {n}',
      combat_round_title: 'Mevcut Tur',
      combat_status_title: '✨ Status Efektleri Paneli',
      combat_prev_title: 'Önceki Tur',
      combat_next_title: 'Sonraki Tur (Space / N)',
      combat_reroll_title: 'Zarları Yeniden At',
      combat_close_title: 'Combat Modunu Kapat',
      combat_mode_btn: 'Combat Modu',
      combat_mode_btn_title: 'Combat Modunu Aç / Kapat (Kısayol: C)',
      combat_btn_active: 'Aktif',
      hotbar_portrait_title: 'Sırası Gelen Karakter',
      hotbar_active_turn: '⚔️ Aktif Sıra',
      hotbar_open_panel: 'Saldırı Paneli',
      hotbar_open_panel_title: '⚔️ Saldırı Panelini Aç / Odakla',
      combat_started_log: '⚔️ Savaş Modu Başladı! İnisiyatif zarları atıldı.',
      combat_ended_log: '🏳️ Savaş Modu Sonlandırıldı.',

      // Alan Hasarı (AoE)
      aoe_floating_btn: 'Alan Hasarı',
      aoe_floating_btn_title: '💥 Alan Hasarı (AoE) — Haritada daire alan seçip toplu hasar uygula',
      aoe_modal_title: '💥 Alan Hasarı Uygula (AoE)',
      aoe_radius_info: 'Seçilen Alan Yarıçapı: {r} px (~{feet} ft)',
      aoe_targets_count: '{count} Hedef Kapsandı',
      aoe_targets_section: 'Etkilenecek Hedefler:',
      aoe_exempt_hint: '(Tik kaldırarak muaf tutabilirsiniz)',
      aoe_damage_input_label: 'Uygulanacak Hasar Miktarı:',
      aoe_damage_placeholder: 'Örn: 25',
      aoe_reselect_btn: '🔄 Yeniden Seç',
      aoe_submit_btn: '🔥 Hasarı Uygula',
      aoe_combat_only_warning: '⚠️ Alan hasarı sadece Savaş (Combat) Modu aktifken kullanılabilir.',
      aoe_mode_hint: '🎯 Alan Hasarı Modu: Haritada merkeze tıklayıp sürükleyerek yarıçapı belirleyin. [İptal: ESC]',
      aoe_no_targets_alert: 'Seçilen alanda hasar uygulanacak en az bir hedef seçili olmalıdır.',
      aoe_damage_done_log: '💥 Alan Hasarı Uygulandı: {count} hedefe {dmg} hasar uygulandı.',

      // Kontrol Paneli
      control_panel_title: 'Kontrol Paneli',
      mode_gunes: '☀️ Güneş',
      mode_gunes_title: 'Güneş Modu (Varsayılan Oyun Deneyimi)',
      mode_kenan: '🌑 Kenan',
      mode_kenan_title: 'Kenan Modu (Karanlık Sistemi & Tur Bilgisi)',
      kenan_turn_idle: 'Savaş modu başladığında sıradaki savaşçının detayları burada görüntülenir.',
      status_label: 'Durum:',
      logs_waiting: 'Odaya bekleniyor...',
      dm_login_log: 'DM Olarak giriş yaptınız.',
      player_login_log: '{name} olarak giriş yaptınız.',
      player_joined_log: '{name} katıldı.',
      player_disconnected_log: '{name} ayrıldı.',
      map_saved_manual: 'Harita manuel olarak kaydedildi.',
      dice_rolled_log: '<span style="font-weight: bold;">{name}</span> d{sides} attı: <strong>{result}</strong>',
      dice_rolled_crit_success: '<span style="font-weight: bold;">{name}</span> d20 attı: <strong style="color: #2ecc71;">20 (Kritik Başarı!)</strong>',
      dice_rolled_crit_fail: '<span style="font-weight: bold;">{name}</span> d20 attı: <strong style="color: #e74c3c;">1 (Kritik Başarısızlık!)</strong>',

      // DM Araçları
      dm_tools_title: 'DM Araçları',
      dm_toggle_combat_title: 'Combat Modunu Başlat / Kapat',
      dm_status_toolbox_title: 'Durum Efektleri ve Yaratıcı',
      dm_batch_attacks_title: 'Harita Tokenlarına Toplu Saldırı Ata',
      dm_save_map_btn: 'Harita Kaydet',
      dm_open_gallery_btn: 'Galeriyi Aç',
      dm_create_token_summary: 'Yeni Token Oluştur & Hazır Şemalar',
      token_preset_title: '📜 Kayıtlı Hazır Şemalar',
      token_preset_count: '{n} Şema',
      token_preset_select_opt: '— Hazır Şema Seç (Değerleri Doldur) —',
      token_preset_del_title: "Seçili Şemayı Supabase'den Sil",
      token_name_label: 'Token / İşaret Adı:',
      token_name_placeholder: 'Ör: Goblin Okçu veya G',
      token_img_label: 'İşaret Resim URL (Opsiyonel):',
      token_img_placeholder: 'URL girin veya resim sürükleyin...',
      token_color_label: 'Renk:',
      token_type_label: 'Token / Varlık Türü:',
      entity_creature: '👤 Canlı Yaratık / NPC',
      entity_explosive: '💣 Patlayıcı Nesne (Ölümde Patlar)',
      entity_aura: '🔮 Aura / Totem (Her Tur Etki Yayar)',
      entity_spawner: '🌀 Çağırıcı / Yuva (Her Tur Düşman Doğurur)',
      object_function_title: '⚙️ Nesne İşlev Ayarları',
      object_hint_explosion: 'Patlama / Alan Etkisi',
      object_radius_label: 'Etki Yarıçapı (px):',
      object_damage_label: 'Hasar Miktarı:',
      object_damage_type_label: 'Hasar Türü:',
      damage_type_fire: '🔥 Ateş (Fire)',
      damage_type_necrotic: '💀 Nekrotik (Necrotic)',
      damage_type_poison: '🧪 Zehir (Poison)',
      damage_type_acid: '🧪 Asit (Acid)',
      damage_type_lightning: '⚡ Yıldırım (Lightning)',
      damage_type_cold: '❄️ Soğuk (Cold)',
      damage_type_force: '🌀 Kuvvet (Force)',
      damage_type_radiant: '✨ Işıma (Radiant)',
      damage_type_physical: '⚔️ Fiziksel (Physical)',
      target_filter_label: 'Hedef Filtresi:',
      target_filter_all: '👥 Herkes (Dost & Düşman)',
      target_filter_players: '🛡️ Sadece Oyuncular',
      target_filter_markers: '👾 Sadece Yaratıklar',
      apply_status_effect_label: '✨ Verilecek Durum Efekti:',
      status_select_opt: '— Durum Efekti Seç (Opsiyonel) —',
      destroy_on_detonate: '💥 Patlayınca Haritadan Silinsin',
      aura_timing_label: '🔮 Aura Tetiklenme Zamanı:',
      aura_timing_turn: '⚡ Sırası Geldiğinde (Her Tur)',
      aura_timing_round: '🔄 Raund Başlangıcında',
      spawner_preset_label: '👾 Doğurulacak Düşman Şablonu:',
      spawner_preset_opt: '— Hazır Düşman Seçin —',
      spawner_count_label: 'Dalga Başı Adet:',
      spawner_radius_label: 'Doğma Menzili (px):',
      spawner_timing_label: 'Zamanlama:',
      spawner_destroy_label: '💥 Kırılınca / Canı 0 Olunca Haritadan Silinsin',
      current_hp_label: 'Mevcut HP:',
      max_hp_label: 'Maks HP:',
      size_px_label: 'Boyut (px):',
      ac_label: 'AC:',
      ac_bonus_label: 'AC Bonus:',
      kenan_has_darkness: '🌑 Karanlığa Sahip Olsun',
      kenan_current_darkness: 'Mevcut Karanlık:',
      kenan_max_darkness: 'Maks Karanlık:',
      stat_bonus_hint: 'Stat / Bonus (Saldırı için)',
      assign_attacks_to_token: '⚡ Tokene Saldırı Ata (Opsiyonel)',
      attacks_loading: 'Saldırı presetleri yükleniyor...',
      spawn_to_map_btn: '🚀 Haritaya Spawn Et',
      spawn_to_map_title: 'Belirtilen özelliklerdeki tokeni haritaya yerleştirir',
      save_token_preset_btn: '💾 Şema Olarak Kaydet',
      save_token_preset_title: "Girilen can, stat, isim ve resim değerlerini Supabase'e şema olarak kaydeder",
      dm_pen_title: 'DM Kalem Rengi',
      drawing_color_label: 'Çizim Rengi:',
      update_color_btn: 'Rengi Güncelle',
      bg_url_label: 'Arka Plan URL:',
      bg_url_placeholder: 'URL girin veya resim sürükleyin...',
      change_bg_btn: 'Arka Planı Değiştir',
      clear_all_drawings_btn: 'Tüm Çizimleri Temizle',
      manage_players_title: 'Oyuncuları Yönet',
      no_connected_players: 'Bağlı oyuncu yok.',
      selected_player_title: 'Seçilen Oyuncu',
      token_size_label: '📏 Token Boyutu:',
      size_tiny_title: 'Minik (35px)',
      size_medium_title: 'Orta (Standart 1x1) — 50px',
      size_large_title: 'Büyük (2x2) — 80px',
      size_huge_title: 'Devasa (3x3) — 120px',
      size_gargantuan_title: 'Muazzam (4x4) — 160px',
      corruption_label: 'Yozlaşma:',
      stats_label: 'Stat / Bonus',
      spell_slots_label: 'Büyü Slotları',
      active_status_effects_label: '✨ Aktif Durum Efektleri:',
      clear_all_effects_btn: 'Tümünü Kaldır',
      add_status_effect_opt: '— Durum Efekti Ekle —',
      duration_placeholder: 'Tur (Boş=Kalıcı)',
      add_effect_btn: '➕ Ekle',
      assigned_attacks_title: '⚔️ Atanmış Saldırılar (Hotbar Loadout):',
      assigned_attacks_count: '({n} Seçili)',
      assigned_attacks_hint: 'Alt barda görünecek saldırıları seçin (Sınırsız)',
      search_attacks_placeholder: 'Saldırı ara...',
      select_all_btn: 'Tümünü Seç',
      clear_btn: 'Temizle',
      right_click_delete_marker_hint: '* Bir işareti silmek için üzerine sağ tıklayın.',

      // Saldırı Paneli
      attack_panel_title: '⚔️ Saldırı / Hasar Paneli',
      equipped_preset_heading: '🎯 Kuşanılmış Saldırı Preseti',
      btn_presets: '⚙️ Presetler',
      free_attack_opt: '— Serbest Saldırı (Özel Zar Havuzu) —',
      stat_chip: 'STR',
      physical_chip: 'Fiziksel',
      half_miss_chip: '🛡️ Iska: ½ Hasar',
      status_chip: '✨ Durum',
      aoe_chip: '💥 Alan Hasarı',
      attacker_and_target_heading: '🗡️ Saldıran & 🎯 Hedef',
      refresh_list_title: 'Listeyi yenile',
      attacker_select_label: '🗡️ Saldıran (statları kullanılır):',
      attacker_select_opt: '— Saldıran Seç —',
      no_attacker_selected: 'Saldıran seçilmedi',
      target_select_label: "🎯 Hedef (AC'si kontrol edilir, hasarı alır):",
      target_clear_title: 'Tüm hedefleri ve seçim çerçevelerini temizle',
      target_select_opt: '— Hedef Seç —',
      target_ctrl_hint: "💡 Haritadaki token'lara <strong>Ctrl + Sol Tık</strong> ile çoklu hedef seçebilirsiniz.",
      no_target_selected: 'Hedef seçilmedi',
      modifiers_heading: '📊 Modifikatörler',
      dice_stat_label: 'Zar Stat',
      target_ac_label: 'Hedef AC',
      manual_bonus_label: 'Manuel Ek',
      attack_count_label: 'Saldırı Adet',
      advantage_label: 'Avantaj',
      disadvantage_label: 'Dezavantaj',
      damage_channels_heading: '⚔️ Hasar Kanalları',
      phys_main_channel: 'Fiziksel/Ana:',
      type_slashing: '⚔️ Kesme',
      type_bludgeoning: '🔨 Ezme',
      type_piercing: '🏹 Delme',
      type_magic: '✨ Büyü',
      no_dice_selected: 'Zar seçilmedi',
      roll_this_pool_only: 'Zar At',
      clear_pool_title: 'Havuzu temizle',
      elem1_label: 'Ateş/El.1',
      elem2_label: 'Buz/El.2',
      spell_slot_control_title: '✨ Büyü Slotu Kullanımı',
      required_min_lvl: 'Gerekli: Min Lvl {n}',
      btn_attack: '⚔️ SALDIR',
      btn_heal: '💚 ŞİFA VER',
      combat_log_title: 'Savaş Logu',
      apply_damage_btn: 'Hasarı Uygula',
      apply_heal_btn: 'Şifayı Uygula',

      // Oyuncu Bilgi Paneli
      my_character_heading: 'Karakterim',
      customize_token_heading: 'Token Özelleştir',
      token_img_label_player: 'Token Resim URL:',
      token_color_label_player: 'Çizim ve Token Rengi:',
      apply_btn_player: 'Uygula',
      clear_my_drawings_btn: 'Sadece Benim Çizimlerimi Temizle',
      other_players_heading: 'Diğer Oyuncular',
      no_other_players: 'Odada başka oyuncu yok.',
      char_info_failed: 'Karakter bilgisi yüklenemedi.',

      // Modallar: Marker Editörü
      marker_editor_title: 'Token Düzenle',
      marker_name_label: 'İşaret/Token Adı (harf):',
      marker_name_placeholder: 'Ör: G',
      btn_detonate_now: '💥 Patlat',
      btn_pulse_aura: '🔮 Nabız Ver',
      btn_spawn_wave: '🌀 Doğur (Test)',
      save_marker_edit_btn: 'Kaydet',
      cancel_marker_edit_btn: 'İptal',

      // Modallar: Status Toolbox
      status_toolbox_title: '✨ Status Efektleri & Yaratıcı',
      status_target_token_label: '🎯 Hedef Token:',
      status_target_hint: '💡 Ctrl+Click ile haritadan da hedef seçebilirsiniz',
      status_target_selected_opt: '-- Seçili Hedefler (Haritadakiler) --',
      status_tab_presets: '📜 Hazır & Özel Şablonlar',
      status_tab_builder: '🛠️ Özel Efekt Yarat (Builder)',
      status_effect_name_label: 'Efekt Adı:',
      status_name_placeholder: 'Örn: Alevli Lanet, Kutsal Koruma',
      status_icon_label: 'İkon / Emoji:',
      status_rules_heading: 'Modifikatör Kuralları:',
      rule_dot: '🔥 Tur Sonu Hasar (DoT)',
      rule_blind: '👁️ Körlük',
      rule_blind_desc: '(Kendi yapacağı saldırılar dezavantajlı)',
      rule_paralyzed: '⚡ Felç',
      rule_paralyzed_desc: '(Gelen tüm saldırılar kesin vurur & 2x kritik)',
      rule_shelter: '🛡️ Barınak',
      rule_shelter_desc: '(Hasar almaz - Dokunulmaz)',
      rule_prepared: '🎯 Hazır',
      rule_prepared_desc: '(Gelen saldırılar dezavantajlı olur)',
      rule_unstoppable: '🦏 Durdurulamaz',
      rule_unstoppable_desc: '(Felç etkisine bağışıklık)',
      rule_res_title: '🛡️ Hasar Dirençleri (0.5x Hasar):',
      res_bludgeoning: '🔨 Ezme Direnci',
      res_slashing: '⚔️ Kesme Direnci',
      res_piercing: '🏹 Delme Direnci',
      res_magic: '🔮 Büyü Direnci',
      rule_vuln_title: '💥 Hasar Zayıflıkları (2x Hasar):',
      vuln_bludgeoning: '💥🔨 Ezme Zayıflığı',
      vuln_slashing: '💥⚔️ Kesme Zayıflığı',
      vuln_piercing: '💥🏹 Delme Zayıflığı',
      vuln_magic: '💥✨ Büyü Zayıflığı',
      duration_label: 'Süre:',
      duration_rounds_label: 'Tur / Round',
      duration_permanent_label: 'Süresiz / Kalıcı',
      btn_save_status_template: '💾 Şablonu Kaydet',
      btn_apply_status_to_target: '⚡ Hedefe Uygula',

      // Modallar: Attack Presets
      attack_presets_modal_title: '🎯 Hazır Saldırı Presetleri & Yöneticisi',
      atk_tab_list: '📜 Saldırı Presetleri Kataloğu',
      atk_tab_builder: '🛠️ Yeni Saldırı Yarat (Builder)',
      atk_search_placeholder: 'Presetlerde ara (ad, stat, tür)...',
      btn_new_preset: '+ Yeni Preset Ekle',
      builder_mode_new: '✨ Yeni Saldırı Preseti Yarat (Sınırsız)',
      builder_mode_edit: '✏️ Preseti Düzenle: {name}',
      btn_cancel_edit_preset: '✕ İptal / Yeni Presete Dön',
      atk_name_label: 'Saldırı / Aksiyon Adı:',
      atk_name_placeholder: 'Örn: Kutsal Şifa, Vampirik Darbe',
      atk_stat_label: 'ZarStat (Bonus):',
      atk_nature_label: 'Aksiyon Niteliği / Rolü:',
      nature_damage: '⚔️ Hasar Saldırısı (Doğrudan Zar/Hasar)',
      nature_heal: '💚 Can Yenileme / Şifa (Doğrudan İyileştirme)',
      nature_hybrid: '🩸 Hibrit (Hasar Vururken Can Yenileme / Çalma)',
      heal_settings_title: '💚 Şifa / Can Yenileme Ayarları',
      heal_settings_hint: 'Can basma ve vampirik sömürü',
      heal_dice_label: 'Şifa Zarları:',
      heal_target_label: 'Şifa Kime Uygulanacak?',
      heal_target_self: '👤 Kullanan / Saldıran (Self / Can Çalma)',
      heal_target_other: '🎯 Hedeflenen Kişi (Müttefik / Dost)',
      lifesteal_percent_label: '🩸 Can Çalma Oranı (%):',
      lifesteal_percent_desc: "Hasarın %'si kadar can çalar",
      attack_count_builder: 'Saldırı Adedi:',
      consumes_spell_slot_check: '✨ Büyü Slotu Harcar',
      base_spell_lvl_label: 'Taban Büyü Seviyesi (Minimum):',
      base_spell_lvl_desc: 'En az bu seviye slot ile saldıralabilir. Üst slotlarla saldırdığında aşağıdaki seviye zarları geçerli olur.',
      lvl_tab_1: 'Seviye 1 (Taban)',
      lvl_tab_2: 'Seviye 2',
      lvl_tab_3: 'Seviye 3',
      lvl_tab_4: 'Seviye 4',
      copy_base_to_lvl: '📋 Tabanı Kopyala',
      clear_curr_lvl: '🗑️ Seviyeyi Sıfırla (Boş Bırak)',
      dice_pools_heading: '🎲 Zar Havuzları',
      main_damage_pool: 'Ana Hasar:',
      status_on_hit_label: 'İsabet Halinde Durum Etkisi Bağla:',
      status_none_opt: '— Durum Etkisi Yok —',
      half_miss_check: '🛡️ Iska Olsa Bile Yarım Hasar Vur',
      is_aoe_check: '💥 Alan Hasarı (AoE)',
      is_aoe_desc: 'Saldırı isabet ettiğinde hedef çevresindeki düşmanlara patlama hasarı verir',
      aoe_radius_label: 'Patlama Yarıçapı:',
      meters_unit: 'Metre (m)',
      meters_grid_hint: '(~1 grid karesi)',
      desc_note_label: 'Açıklama / Not:',
      desc_note_placeholder: 'Örn: 1d6+2 Fiziksel + 1d6 Ateş. Yanma uygular.',
      btn_save_atk_preset: '💾 Preseti Kaydet',
      btn_equip_and_save_preset: '⚡ Kuşan & Kaydet',

      // Modallar: Toplu Saldırı Atama
      batch_attacks_modal_title: '⚡ Tokenlara Toplu Saldırı Ata',
      batch_attacks_intro: 'Haritadaki mevcut veya seçilen tokenlara (canavar/NPC) tek seferde saldırı presetleri atayın.',
      batch_col_tokens_title: '👾 1. Hedef Tokenları Seçin',
      batch_tokens_count: '{n} Token',
      batch_search_tokens: 'Token ara...',
      batch_col_attacks_title: '⚔️ 2. Atanacak Saldırıları Seçin',
      batch_attacks_count: '{n} Saldırı',
      batch_search_attacks: 'Saldırı preset ara...',
      batch_mode_label: 'Atama Modu:',
      batch_mode_append: '➕ Mevcutlara Ekle',
      batch_mode_replace: '🔄 Üzerine Yaz (Yenileriyle Değiştir)',
      batch_summary_badge: '{tokens} Token | {attacks} Saldırı seçildi',
      btn_submit_batch_attacks: '⚡ Seçili Tokenlara Ata',

      // Modallar: AoE Hasar Modalı
      aoe_modal_title: '💥 Alan Hasarı Uygula (AoE)',
      aoe_radius_info: 'Seçilen Alan Yarıçapı: {radius} px',
      aoe_radius_info_full: 'Seçilen Alan: Yarıçap {radius} px (~{feet} ft)',
      aoe_targets_count: '{n} Hedef Kapsandı',
      aoe_targets_section: 'Etkilenecek Hedefler:',
      aoe_exempt_hint: '(Tik kaldırarak muaf tutabilirsiniz)',
      aoe_damage_input_label: 'Uygulanacak Hasar Miktarı:',
      aoe_damage_placeholder: 'Örn: 25',
      aoe_reselect_btn: '🔄 Yeniden Seç',
      aoe_submit_btn: '🔥 Hasarı Uygula',
      aoe_active_banner: '🎯 AoE Alan Hasarı Modu: Haritada sürükleyerek çember alanı belirleyin',
      aoe_combat_only_warn: '⚠️ Alan hasarı sadece Savaş (Combat) Modu aktifken kullanılabilir.',
      aoe_start_hint: '🎯 Alan Hasarı Modu: Haritada merkeze tıklayıp sürükleyerek yarıçapı belirleyin. [İptal: ESC]',
      aoe_no_targets_found: '⚠️ Seçilen alanda hiçbir token veya hedef bulunamadı.',
      aoe_alert_no_targets: 'Seçilen alanda hasar uygulanacak en az bir hedef seçili olmalıdır.',
      aoe_detonating_btn: 'Patlatılıyor...',

      // Combat Tracker Logları ve Ekranı
      combat_round_display: 'Tur {n}',
      combat_started_log: '⚔️ Savaş Modu Başladı! İnisiyatif zarları atıldı.',
      combat_ended_log: '🏳️ Savaş Modu Sonlandırıldı.',
      no_attacks_assigned_notice: '⚠️ Bu karaktere özel saldırı atanmadı (Panelden seçin).',
      marker_fallback: 'İşaret',
      player_fallback: 'Oyuncu',
      no_connected_players: 'Bağlı oyuncu yok.',
      no_other_players: 'Odada başka oyuncu yok.',
      player_joined_log: '{name} katıldı.',
      map_manually_saved_log: 'Harita manuel olarak kaydedildi.',
      confirm_clear_own_drawings: 'Kendi çizimlerinizi temizlemek istiyor musunuz?',
      confirm_clear_all_drawings: 'TÜM çizimleri temizlemek istiyor musunuz?',
      dice_rolled_log: '<span style="font-weight: bold;">{name}</span> d{type} attı: <strong>{result}</strong>',
      dice_rolled_crit_success: '<span style="font-weight: bold;">{name}</span> d20 attı: <strong style="color: #2ecc71;">20 (Kritik Başarı!)</strong>',
      dice_rolled_crit_fail: '<span style="font-weight: bold;">{name}</span> d20 attı: <strong style="color: #e74c3c;">1 (Kritik Başarısızlık!)</strong>',
      dice_toast_text: '{name}: d{type} 🎲 {result}',
      dice_toast_crit_success: '{name}: 🎲 20 (Kritik!)',
      dice_toast_crit_fail: '{name}: 🎲 1 (Kritik!)',
      toggle_panel_aria: 'Paneli Aç/Kapat',
      logged_in_as_dm: 'DM Olarak giriş yaptınız.',
      logged_in_as_player: '{name} olarak giriş yaptınız.',
      unknown_error: 'Bilinmeyen hata',
      rolled_dice: 'd{type} attı',

      // Token Context Menüsü
      token_ctx_size_label: 'Token Boyutu:',
      token_ctx_custom_placeholder: 'Özel px',
      token_ctx_apply: 'Uygula',
      token_ctx_edit_char: '⚙️ Karakteri Düzenle',

      // Uyarılar ve Onaylar
      alert_token_not_found: 'Düzenlenen token bulunamadı!',
      alert_select_status: 'Lütfen eklenecek durum efektini seçin!',
      alert_player_not_found: 'Düzenlenen oyuncu bulunamadı!',
      alert_images_only: 'Lütfen sadece resim dosyası sürükleyin.',
      alert_image_upload_fail: 'Resim yüklenemedi: ',
      alert_image_upload_err: 'Resim yüklenirken bir hata oluştu.',
      alert_file_read_err: 'Dosya okunamadı!',
      alert_select_target_status: 'Lütfen efekti uygulamak için en az bir HEDEF seçin!',
      alert_give_status_name: 'Lütfen efekte bir İsim verin!',
      alert_status_saved: '"{name}" özel efekt şablonu kaydedildi!',
      alert_select_batch_tokens: 'Lütfen en az bir hedef token seçin.',
      alert_select_batch_attacks: 'Lütfen tokenlara atanacak en az bir saldırı preseti seçin.',
      alert_select_attacker: 'Lütfen bir SALDIRAN seçin!',
      alert_select_target: 'Lütfen en az bir HEDEF seçin!',
      alert_spell_slot_req: 'Bu saldırı en az Seviye {lvl} büyü slotu gerektirir!',
      alert_no_spell_slots: '{name} — Seviye {lvl} büyü slotu kalmadı! Lütfen başka bir seviye seçin veya dinlenin.',
      alert_no_damage_or_spell: 'Uygulanacak hasar veya büyü yok!',
      alert_give_preset_name: 'Lütfen saldırı preseti için bir İsim girin!',
      alert_preset_saved: '"{name}" saldırı preseti kaydedildi!',
      confirm_delete_template: '"{name}" şablonunu silmek istediğinize emin misiniz?',
      confirm_delete_preset: '"{name}" presetini silmek istediğinize emin misiniz?',

      // Varsayılan Status Presetleri
      preset_burn_name: 'Yanma',
      preset_bleed_name: 'Kanama',
      preset_blind_name: 'Körlük',
      preset_paralyzed_name: 'Felç',
      preset_regen_name: 'Yenilenme (Rejenerasyon)',
      preset_blessed_name: 'Kutsanmış',
      preset_lifesteal_name: 'Yaşam Çalma',

      // Varsayılan Saldırı Presetleri
      atk_preset_flame_sword_name: 'Alev Kılıcı',
      atk_preset_cure_wounds_name: 'Kutsal Şifa',
      atk_preset_vampiric_touch_name: 'Vampirik Dokunuş'
    }
  };

  class I18nManager {
    constructor() {
      const savedLang = localStorage.getItem(STORAGE_KEY);
      this.currentLang = savedLang === 'tr' ? 'tr' : DEFAULT_LANG;
      this.translations = translations;
    }

    getLanguage() {
      return this.currentLang;
    }

    setLanguage(lang) {
      if (lang !== 'en' && lang !== 'tr') return;
      this.currentLang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch (e) {
        console.warn('localStorage not accessible for i18n:', e);
      }
      document.documentElement.lang = lang;
      this.translateDOM();
      this.updateSwitcherButtons();

      // Trigger custom event so all scripts can react
      const event = new CustomEvent('dnd:languageChange', {
        detail: { lang: this.currentLang }
      });
      window.dispatchEvent(event);
      document.dispatchEvent(event);
    }

    t(key, params = {}, fallback = null) {
      const dict = this.translations[this.currentLang] || this.translations.en;
      let text = dict[key];

      if (text === undefined) {
        // Fallback to English dictionary
        text = this.translations.en[key];
      }

      if (text === undefined) {
        return fallback != null ? fallback : key;
      }

      // Replace interpolation params like {name}
      if (params && typeof params === 'object') {
        Object.entries(params).forEach(([paramKey, val]) => {
          text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), val != null ? String(val) : '');
        });
      }

      return text;
    }

    /**
     * Translates default preset names/descriptions if applicable
     */
    translatePresetName(id, originalName) {
      if (!id) return originalName;
      const key = `${id}_name`;
      const trans = this.t(key, {}, null);
      if (trans && trans !== key) return trans;
      return originalName;
    }

    translateDOM(root = document) {
      // 1. Plain text elements
      const elements = root.querySelectorAll('[data-i18n]');
      elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        let params = {};
        const paramsAttr = el.getAttribute('data-i18n-params');
        if (paramsAttr) {
          try { params = JSON.parse(paramsAttr); } catch (e) {}
        }
        const translation = this.t(key, params, null);
        if (translation && translation !== key) {
          el.textContent = translation;
        }
      });

      // 2. HTML elements
      const htmlElements = root.querySelectorAll('[data-i18n-html]');
      htmlElements.forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (!key) return;
        let params = {};
        const paramsAttr = el.getAttribute('data-i18n-params');
        if (paramsAttr) {
          try { params = JSON.parse(paramsAttr); } catch (e) {}
        }
        const translation = this.t(key, params, null);
        if (translation && translation !== key) {
          el.innerHTML = translation;
        }
      });

      // 3. Placeholders
      const placeholderElements = root.querySelectorAll('[data-i18n-placeholder]');
      placeholderElements.forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;
        const translation = this.t(key, {}, null);
        if (translation && translation !== key) {
          el.placeholder = translation;
        }
      });

      // 4. Titles / Tooltips
      const titleElements = root.querySelectorAll('[data-i18n-title]');
      titleElements.forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (!key) return;
        const translation = this.t(key, {}, null);
        if (translation && translation !== key) {
          el.title = translation;
        }
      });

      // 5. Aria Labels
      const ariaElements = root.querySelectorAll('[data-i18n-aria]');
      ariaElements.forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        if (!key) return;
        const translation = this.t(key, {}, null);
        if (translation && translation !== key) {
          el.setAttribute('aria-label', translation);
        }
      });

      // 6. Page Title
      const titleTag = document.querySelector('title[data-i18n]');
      if (titleTag) {
        const key = titleTag.getAttribute('data-i18n');
        if (key) document.title = this.t(key);
      }
    }

    updateSwitcherButtons() {
      const buttons = document.querySelectorAll('.lang-btn');
      buttons.forEach(btn => {
        const btnLang = btn.getAttribute('data-lang');
        if (btnLang === this.currentLang) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    bindSwitchers() {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.lang-btn');
        if (!btn) return;
        const lang = btn.getAttribute('data-lang');
        if (lang && (lang === 'en' || lang === 'tr')) {
          this.setLanguage(lang);
        }
      });
      this.updateSwitcherButtons();
    }

    init() {
      document.documentElement.lang = this.currentLang;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          this.translateDOM();
          this.bindSwitchers();
        });
      } else {
        this.translateDOM();
        this.bindSwitchers();
      }
    }
  }

  // Create singleton instance
  window.i18n = new I18nManager();
  window.I18n = window.i18n;
  window.t = window.i18n.t.bind(window.i18n);
  window.i18n.init();
})();
