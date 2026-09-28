export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      achievements: {
        Row: {
          key: Database['public']['Enums']['achievement_key'];
          pack_id: string;
          unlocked_at: string;
        };
        Insert: {
          key: Database['public']['Enums']['achievement_key'];
          pack_id: string;
          unlocked_at?: string;
        };
        Update: {
          key?: Database['public']['Enums']['achievement_key'];
          pack_id?: string;
          unlocked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'achievements_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
        ];
      };
      app_errors: {
        Row: {
          app_version: string | null;
          created_at: string;
          fatal: boolean;
          id: number;
          message: string;
          platform: string;
          screen: string | null;
          stack: string | null;
          user_id: string | null;
        };
        Insert: {
          app_version?: string | null;
          created_at?: string;
          fatal?: boolean;
          id?: never;
          message: string;
          platform: string;
          screen?: string | null;
          stack?: string | null;
          user_id?: string | null;
        };
        Update: {
          app_version?: string | null;
          created_at?: string;
          fatal?: boolean;
          id?: never;
          message?: string;
          platform?: string;
          screen?: string | null;
          stack?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'app_errors_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      app_owners: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'app_owners_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      blocked_words: {
        Row: {
          match: string;
          word: string;
        };
        Insert: {
          match?: string;
          word: string;
        };
        Update: {
          match?: string;
          word?: string;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blocks_blocked_id_fkey';
            columns: ['blocked_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blocks_blocker_id_fkey';
            columns: ['blocker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      critters: {
        Row: {
          coins: number;
          hatched_at: string | null;
          health: number;
          marks: string[];
          name: string | null;
          outfit: NonNullable<Json>;
          pack_id: string;
          species: Database['public']['Enums']['critter_species'];
          stage: Database['public']['Enums']['critter_stage'];
          status: Database['public']['Enums']['critter_status'];
          streak: number;
          xp: number;
        };
        Insert: {
          coins?: number;
          hatched_at?: string | null;
          health?: number;
          marks?: string[];
          name?: string | null;
          outfit?: NonNullable<Json>;
          pack_id: string;
          species: Database['public']['Enums']['critter_species'];
          stage?: Database['public']['Enums']['critter_stage'];
          status?: Database['public']['Enums']['critter_status'];
          streak?: number;
          xp?: number;
        };
        Update: {
          coins?: number;
          hatched_at?: string | null;
          health?: number;
          marks?: string[];
          name?: string | null;
          outfit?: NonNullable<Json>;
          pack_id?: string;
          species?: Database['public']['Enums']['critter_species'];
          stage?: Database['public']['Enums']['critter_stage'];
          status?: Database['public']['Enums']['critter_status'];
          streak?: number;
          xp?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'critters_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: true;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
        ];
      };
      day_passes: {
        Row: {
          created_at: string;
          day: string;
          kind: Database['public']['Enums']['day_pass_kind'];
          month: string;
          pack_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          day: string;
          kind: Database['public']['Enums']['day_pass_kind'];
          month?: never;
          pack_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          day?: string;
          kind?: Database['public']['Enums']['day_pass_kind'];
          month?: never;
          pack_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'day_passes_pack_id_user_id_fkey';
            columns: ['pack_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'pack_members';
            referencedColumns: ['pack_id', 'user_id'];
          },
        ];
      };
      day_results: {
        Row: {
          applied: boolean;
          closed_at: string;
          coins: number;
          day: string;
          early_bird: boolean;
          fed_ids: string[];
          full_house: boolean;
          health_after: number;
          health_before: number;
          joker_ids: string[];
          missed_ids: string[];
          night_owl_feeds: number;
          pack_id: string;
          paused_ids: string[];
          rested_ids: string[];
          result: Database['public']['Enums']['day_type'];
          sleeping_ids: string[];
        };
        Insert: {
          applied: boolean;
          closed_at?: string;
          coins?: number;
          day: string;
          early_bird?: boolean;
          fed_ids?: string[];
          full_house?: boolean;
          health_after: number;
          health_before: number;
          joker_ids?: string[];
          missed_ids?: string[];
          night_owl_feeds?: number;
          pack_id: string;
          paused_ids?: string[];
          rested_ids?: string[];
          result: Database['public']['Enums']['day_type'];
          sleeping_ids?: string[];
        };
        Update: {
          applied?: boolean;
          closed_at?: string;
          coins?: number;
          day?: string;
          early_bird?: boolean;
          fed_ids?: string[];
          full_house?: boolean;
          health_after?: number;
          health_before?: number;
          joker_ids?: string[];
          missed_ids?: string[];
          night_owl_feeds?: number;
          pack_id?: string;
          paused_ids?: string[];
          rested_ids?: string[];
          result?: Database['public']['Enums']['day_type'];
          sleeping_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'day_results_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
        ];
      };
      feeds: {
        Row: {
          caption: string | null;
          captured_at: string | null;
          created_at: string;
          day: string;
          focus_minutes: number | null;
          hidden_at: string | null;
          id: string;
          is_extra: boolean;
          pack_id: string;
          photo_path: string | null;
          user_id: string;
        };
        Insert: {
          caption?: string | null;
          captured_at?: string | null;
          created_at?: string;
          day: string;
          focus_minutes?: number | null;
          hidden_at?: string | null;
          id?: string;
          is_extra?: boolean;
          pack_id: string;
          photo_path?: string | null;
          user_id: string;
        };
        Update: {
          caption?: string | null;
          captured_at?: string | null;
          created_at?: string;
          day?: string;
          focus_minutes?: number | null;
          hidden_at?: string | null;
          id?: string;
          is_extra?: boolean;
          pack_id?: string;
          photo_path?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feeds_pack_id_user_id_fkey';
            columns: ['pack_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'pack_members';
            referencedColumns: ['pack_id', 'user_id'];
          },
        ];
      };
      name_suggestions: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          pack_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          pack_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          pack_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'name_suggestions_pack_id_user_id_fkey';
            columns: ['pack_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'pack_members';
            referencedColumns: ['pack_id', 'user_id'];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          day: string | null;
          id: string;
          pack_id: string | null;
          payload: NonNullable<Json>;
          send_after: string;
          sent_at: string | null;
          status: Database['public']['Enums']['notification_status'];
          type: Database['public']['Enums']['notification_type'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          day?: string | null;
          id?: string;
          pack_id?: string | null;
          payload?: NonNullable<Json>;
          send_after?: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          type: Database['public']['Enums']['notification_type'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          day?: string | null;
          id?: string;
          pack_id?: string | null;
          payload?: NonNullable<Json>;
          send_after?: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          type?: Database['public']['Enums']['notification_type'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      nudges: {
        Row: {
          created_at: string;
          day: string;
          from_user: string;
          pack_id: string;
          to_user: string;
        };
        Insert: {
          created_at?: string;
          day: string;
          from_user: string;
          pack_id: string;
          to_user: string;
        };
        Update: {
          created_at?: string;
          day?: string;
          from_user?: string;
          pack_id?: string;
          to_user?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'nudges_pack_id_from_user_fkey';
            columns: ['pack_id', 'from_user'];
            isOneToOne: false;
            referencedRelation: 'pack_members';
            referencedColumns: ['pack_id', 'user_id'];
          },
          {
            foreignKeyName: 'nudges_pack_id_to_user_fkey';
            columns: ['pack_id', 'to_user'];
            isOneToOne: false;
            referencedRelation: 'pack_members';
            referencedColumns: ['pack_id', 'user_id'];
          },
        ];
      };
      pack_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          id: string;
          kind: Database['public']['Enums']['pack_event_kind'];
          pack_id: string;
          payload: NonNullable<Json>;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          kind: Database['public']['Enums']['pack_event_kind'];
          pack_id: string;
          payload?: NonNullable<Json>;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['pack_event_kind'];
          pack_id?: string;
          payload?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'pack_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pack_events_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
        ];
      };
      pack_items: {
        Row: {
          bought_at: string;
          bought_by: string | null;
          item: string;
          pack_id: string;
        };
        Insert: {
          bought_at?: string;
          bought_by?: string | null;
          item: string;
          pack_id: string;
        };
        Update: {
          bought_at?: string;
          bought_by?: string | null;
          item?: string;
          pack_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pack_items_bought_by_fkey';
            columns: ['bought_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pack_items_item_fkey';
            columns: ['item'];
            isOneToOne: false;
            referencedRelation: 'shop_items';
            referencedColumns: ['item'];
          },
          {
            foreignKeyName: 'pack_items_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
        ];
      };
      pack_members: {
        Row: {
          awake_since: string | null;
          joined_at: string;
          left_at: string | null;
          pack_id: string;
          removed_at: string | null;
          role: Database['public']['Enums']['member_role'];
          status: Database['public']['Enums']['member_status'];
          user_id: string;
        };
        Insert: {
          awake_since?: string | null;
          joined_at?: string;
          left_at?: string | null;
          pack_id: string;
          removed_at?: string | null;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          user_id: string;
        };
        Update: {
          awake_since?: string | null;
          joined_at?: string;
          left_at?: string | null;
          pack_id?: string;
          removed_at?: string | null;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pack_members_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pack_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      packs: {
        Row: {
          category: Database['public']['Enums']['habit_category'];
          created_at: string;
          custom_habit: string | null;
          id: string;
          invite_code: string;
          name: string;
          pending_from: string | null;
          pending_rest_days_per_week: number | null;
          pending_week_start: Database['public']['Enums']['week_start'] | null;
          rest_days_per_week: number;
          timezone: string;
          week_start: Database['public']['Enums']['week_start'];
        };
        Insert: {
          category: Database['public']['Enums']['habit_category'];
          created_at?: string;
          custom_habit?: string | null;
          id?: string;
          invite_code: string;
          name: string;
          pending_from?: string | null;
          pending_rest_days_per_week?: number | null;
          pending_week_start?: Database['public']['Enums']['week_start'] | null;
          rest_days_per_week: number;
          timezone: string;
          week_start?: Database['public']['Enums']['week_start'];
        };
        Update: {
          category?: Database['public']['Enums']['habit_category'];
          created_at?: string;
          custom_habit?: string | null;
          id?: string;
          invite_code?: string;
          name?: string;
          pending_from?: string | null;
          pending_rest_days_per_week?: number | null;
          pending_week_start?: Database['public']['Enums']['week_start'] | null;
          rest_days_per_week?: number;
          timezone?: string;
          week_start?: Database['public']['Enums']['week_start'];
        };
        Relationships: [];
      };
      pauses: {
        Row: {
          created_at: string;
          ends_on: string;
          id: string;
          pack_id: string;
          starts_on: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ends_on: string;
          id?: string;
          pack_id: string;
          starts_on: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          id?: string;
          pack_id?: string;
          starts_on?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pauses_pack_id_user_id_fkey';
            columns: ['pack_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'pack_members';
            referencedColumns: ['pack_id', 'user_id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          locale: string;
          notification_prefs: NonNullable<Json>;
          reminder_time: string;
          terms_accepted_at: string | null;
          timezone: string;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          locale?: string;
          notification_prefs?: NonNullable<Json>;
          reminder_time?: string;
          terms_accepted_at?: string | null;
          timezone?: string;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          locale?: string;
          notification_prefs?: NonNullable<Json>;
          reminder_time?: string;
          terms_accepted_at?: string | null;
          timezone?: string;
        };
        Relationships: [];
      };
      push_tokens: {
        Row: {
          platform: Database['public']['Enums']['push_platform'];
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          platform: Database['public']['Enums']['push_platform'];
          token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          platform?: Database['public']['Enums']['push_platform'];
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reactions: {
        Row: {
          created_at: string;
          emoji: Database['public']['Enums']['reaction_emoji'];
          feed_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          emoji: Database['public']['Enums']['reaction_emoji'];
          feed_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          emoji?: Database['public']['Enums']['reaction_emoji'];
          feed_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reactions_feed_id_fkey';
            columns: ['feed_id'];
            isOneToOne: false;
            referencedRelation: 'feeds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reactions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reports: {
        Row: {
          created_at: string;
          feed_id: string;
          handled_at: string | null;
          id: string;
          reason: string | null;
          reporter_id: string;
        };
        Insert: {
          created_at?: string;
          feed_id: string;
          handled_at?: string | null;
          id?: string;
          reason?: string | null;
          reporter_id: string;
        };
        Update: {
          created_at?: string;
          feed_id?: string;
          handled_at?: string | null;
          id?: string;
          reason?: string | null;
          reporter_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reports_feed_id_fkey';
            columns: ['feed_id'];
            isOneToOne: false;
            referencedRelation: 'feeds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      shop_items: {
        Row: {
          item: string;
          price: number;
          slot: string;
          sort: number;
        };
        Insert: {
          item: string;
          price: number;
          slot: string;
          sort: number;
        };
        Update: {
          item?: string;
          price?: number;
          slot?: string;
          sort?: number;
        };
        Relationships: [];
      };
      weekly_recaps: {
        Row: {
          created_at: string;
          feed_ids: string[];
          pack_id: string;
          stats: NonNullable<Json>;
          week_start: string;
        };
        Insert: {
          created_at?: string;
          feed_ids?: string[];
          pack_id: string;
          stats: NonNullable<Json>;
          week_start: string;
        };
        Update: {
          created_at?: string;
          feed_ids?: string[];
          pack_id?: string;
          stats?: NonNullable<Json>;
          week_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'weekly_recaps_pack_id_fkey';
            columns: ['pack_id'];
            isOneToOne: false;
            referencedRelation: 'packs';
            referencedColumns: ['id'];
          },
        ];
      };
      widget_tokens: {
        Row: {
          created_at: string;
          id: string;
          last_used_at: string | null;
          token_hash: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          token_hash: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          token_hash?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'widget_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      account_photo_paths: { Args: { member: string }; Returns: string[] };
      active_pack_count: { Args: { member: string }; Returns: number };
      apply_day_result: {
        Args: { outcome: Json; pack_date: string; target: string };
        Returns: boolean;
      };
      blocked_by_me: { Args: { other_user: string }; Returns: boolean };
      buy_item: { Args: { target: string; wanted: string }; Returns: number };
      call_edge_function:
        | { Args: { name: string }; Returns: undefined }
        | { Args: { body: Json; name: string }; Returns: undefined };
      cancel_day_pass: { Args: { target: string }; Returns: undefined };
      choose_name: { Args: { suggestion: string; target: string }; Returns: undefined };
      claim_notifications: {
        Args: { at_time?: string; max_rows?: number };
        Returns: {
          critter_name: string;
          id: string;
          locale: string;
          names: string[];
          pack_id: string;
          pack_name: string;
          payload: Json;
          species: Database['public']['Enums']['critter_species'];
          tokens: string[];
          type: Database['public']['Enums']['notification_type'];
          user_id: string;
        }[];
      };
      clean_up_old_rows: { Args: { at_time?: string }; Returns: undefined };
      counted_on: { Args: { member: string; pack_date: string; target: string }; Returns: boolean };
      create_pack: {
        Args: {
          habit: Database['public']['Enums']['habit_category'];
          habit_text?: string;
          pack_name: string;
          rest_days: number;
          species: Database['public']['Enums']['critter_species'];
          time_zone: string;
        };
        Returns: string;
      };
      create_widget_token: { Args: Record<PropertyKey, never>; Returns: string };
      day_close_input: { Args: { pack_date: string; target: string }; Returns: Json };
      day_closes_at: { Args: { pack_date: string; tz: string }; Returns: string };
      dress_critter: { Args: { item: string; slot: string; target: string }; Returns: undefined };
      drop_empty_packs: { Args: { at_time: string }; Returns: number };
      empty_pack_photos: { Args: { at_time: string }; Returns: string[] };
      empty_packs: { Args: { at_time: string }; Returns: string[] };
      end_pause: { Args: { target: string }; Returns: undefined };
      expired_photos: {
        Args: { at_time?: string; max_rows?: number };
        Returns: {
          feed_id: string;
          photo_path: string;
        }[];
      };
      fed_on: { Args: { member: string; pack_date: string; target: string }; Returns: boolean };
      feed_day: { Args: { captured_at: string; received_at: string; tz: string }; Returns: string };
      feed_reactions: {
        Args: { feed_ids: string[] };
        Returns: {
          emoji: Database['public']['Enums']['reaction_emoji'];
          feed_id: string;
          mine: boolean;
          names: string[];
          total: number;
        }[];
      };
      forget_photos: { Args: { feed_ids: string[] }; Returns: undefined };
      forget_push_tokens: { Args: { dead: string[] }; Returns: undefined };
      is_clean: { Args: { input: string }; Returns: boolean };
      is_pack_member: { Args: { target_pack: string }; Returns: boolean };
      join_pack: { Args: { code: string }; Returns: string };
      keeps_overnight: {
        Args: { kind: Database['public']['Enums']['notification_type'] };
        Returns: boolean;
      };
      leave_pack: { Args: { target: string }; Returns: undefined };
      my_day_status: { Args: { target: string }; Returns: Json };
      my_stats: { Args: Record<PropertyKey, never>; Returns: Json };
      new_invite_code: { Args: Record<PropertyKey, never>; Returns: string };
      next_week_start: {
        Args: { start: Database['public']['Enums']['week_start']; tz: string };
        Returns: string;
      };
      nudge: { Args: { member: string; target: string }; Returns: undefined };
      orphan_photos: { Args: { at_time?: string; max_rows?: number }; Returns: string[] };
      outcome_ids: { Args: { kind: string; outcomes: Json }; Returns: string[] };
      owns_item: {
        Args: { target: string; wanted_item: string; wanted_slot: string };
        Returns: boolean;
      };
      pack_day: { Args: { at_time?: string; tz: string }; Returns: string };
      pack_first_day: { Args: { target: string }; Returns: string };
      pack_limit: { Args: Record<PropertyKey, never>; Returns: number };
      pack_preview: {
        Args: { code: string };
        Returns: {
          already_member: boolean;
          category: Database['public']['Enums']['habit_category'];
          critter: Json;
          custom_habit: string;
          is_full: boolean;
          member_count: number;
          member_names: string[];
          pack_id: string;
          pack_name: string;
        }[];
      };
      pack_rules_on: {
        Args: { pack_date: string; target: string };
        Returns: {
          rest_days: number;
          week_from: string;
          week_start: Database['public']['Enums']['week_start'];
        }[];
      };
      pack_size_limit: { Args: Record<PropertyKey, never>; Returns: number };
      packs_to_close: {
        Args: { at_time?: string };
        Returns: {
          next_day: string;
          pack_id: string;
          time_zone: string;
        }[];
      };
      pilot_metrics: { Args: { at_time?: string }; Returns: Json };
      queue_daily_summaries: { Args: { at_time?: string }; Returns: number };
      queue_evening_reminders: { Args: { at_time?: string }; Returns: number };
      react: {
        Args: { emoji: Database['public']['Enums']['reaction_emoji']; target_feed: string };
        Returns: undefined;
      };
      register_push_token: {
        Args: { device: Database['public']['Enums']['push_platform']; device_token: string };
        Returns: undefined;
      };
      remove_member: { Args: { member: string; target: string }; Returns: undefined };
      renew_invite_code: { Args: { target: string }; Returns: string };
      report_app_error: {
        Args: {
          app_version?: string;
          device?: string;
          error_message: string;
          error_stack?: string;
          fatal?: boolean;
          screen?: string;
        };
        Returns: undefined;
      };
      report_details: { Args: { report: string }; Returns: Json };
      requeue_notifications: { Args: { ids: string[] }; Returns: undefined };
      require_admin: { Args: { target: string }; Returns: string };
      require_membership: { Args: { member: string; target: string }; Returns: string };
      require_user: { Args: Record<PropertyKey, never>; Returns: string };
      rest_days_used: {
        Args: { member: string; pack_date: string; target: string };
        Returns: number;
      };
      revoke_widget_token: { Args: { token: string }; Returns: undefined };
      shares_pack_with: { Args: { other_user: string }; Returns: boolean };
      start_pause: { Args: { days: number; target: string }; Returns: undefined };
      submit_feed: {
        Args: {
          extra?: boolean;
          focus?: number;
          note?: string;
          photo: string;
          taken_at?: string;
          target: string;
        };
        Returns: string;
      };
      suggest_name: { Args: { suggested: string; target: string }; Returns: string };
      update_pack: {
        Args: {
          pack_name: string;
          rest_days: number;
          starts_on: Database['public']['Enums']['week_start'];
          target: string;
        };
        Returns: undefined;
      };
      use_day_pass: {
        Args: { pass: Database['public']['Enums']['day_pass_kind']; target: string };
        Returns: undefined;
      };
      wants: { Args: { kind: string; prefs: Json }; Returns: boolean };
      wardrobe_achievement: {
        Args: { item: string; slot: string };
        Returns: Database['public']['Enums']['achievement_key'];
      };
      widget_state: { Args: { at_time?: string; token: string }; Returns: Json };
    };
    Enums: {
      achievement_key:
        | 'hatched'
        | 'streak_7'
        | 'streak_14'
        | 'streak_30'
        | 'full_house'
        | 'early_birds'
        | 'night_owls'
        | 'comeback'
        | 'century'
        | 'full_pack'
        | 'grown_up'
        | 'legend';
      critter_species: 'mochi' | 'kit' | 'axo' | 'ribbit' | 'hoot' | 'bun';
      critter_stage: 'egg' | 'baby' | 'kid' | 'teen' | 'adult' | 'legend';
      critter_status: 'egg' | 'active' | 'ran_away';
      day_pass_kind: 'joker' | 'rest';
      day_type: 'success' | 'neutral' | 'fail';
      habit_category:
        | 'gym'
        | 'study'
        | 'reading'
        | 'running'
        | 'water'
        | 'custom'
        | 'walking'
        | 'yoga'
        | 'meditation'
        | 'eating'
        | 'sleep'
        | 'language'
        | 'music'
        | 'journal';
      member_role: 'admin' | 'member';
      member_status: 'active' | 'sleeping' | 'left';
      notification_status: 'pending' | 'sent' | 'dropped';
      notification_type:
        | 'friend_fed'
        | 'evening_reminder'
        | 'last_one'
        | 'nudge'
        | 'pet_state'
        | 'evolution'
        | 'still_in'
        | 'weekly_recap'
        | 'new_user'
        | 'daily_summary';
      pack_event_kind:
        | 'joined'
        | 'hatched'
        | 'evolved'
        | 'ran_away'
        | 'returned'
        | 'achievement'
        | 'joker'
        | 'dressed'
        | 'named'
        | 'bought';
      push_platform: 'ios' | 'android';
      reaction_emoji: 'fire' | 'muscle' | 'laugh' | 'clap' | 'suspicious';
      week_start: 'sunday' | 'monday';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      achievement_key: [
        'hatched',
        'streak_7',
        'streak_14',
        'streak_30',
        'full_house',
        'early_birds',
        'night_owls',
        'comeback',
        'century',
        'full_pack',
        'grown_up',
        'legend',
      ],
      critter_species: ['mochi', 'kit', 'axo', 'ribbit', 'hoot', 'bun'],
      critter_stage: ['egg', 'baby', 'kid', 'teen', 'adult', 'legend'],
      critter_status: ['egg', 'active', 'ran_away'],
      day_pass_kind: ['joker', 'rest'],
      day_type: ['success', 'neutral', 'fail'],
      habit_category: [
        'gym',
        'study',
        'reading',
        'running',
        'water',
        'custom',
        'walking',
        'yoga',
        'meditation',
        'eating',
        'sleep',
        'language',
        'music',
        'journal',
      ],
      member_role: ['admin', 'member'],
      member_status: ['active', 'sleeping', 'left'],
      notification_status: ['pending', 'sent', 'dropped'],
      notification_type: [
        'friend_fed',
        'evening_reminder',
        'last_one',
        'nudge',
        'pet_state',
        'evolution',
        'still_in',
        'weekly_recap',
        'new_user',
        'daily_summary',
      ],
      pack_event_kind: [
        'joined',
        'hatched',
        'evolved',
        'ran_away',
        'returned',
        'achievement',
        'joker',
        'dressed',
        'named',
        'bought',
      ],
      push_platform: ['ios', 'android'],
      reaction_emoji: ['fire', 'muscle', 'laugh', 'clap', 'suspicious'],
      week_start: ['sunday', 'monday'],
    },
  },
} as const;
