export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      events: {
        Row: {
          category: string
          city: string
          created_at: string
          description: string | null
          event_date: string
          event_time: string
          id: string
          image_url: string | null
          organizer_id: string
          scanner_token: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
          venue: string
        }
        Insert: {
          category: string
          city: string
          created_at?: string
          description?: string | null
          event_date: string
          event_time: string
          id?: string
          image_url?: string | null
          organizer_id: string
          scanner_token?: string
          status?: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at?: string
          venue: string
        }
        Update: {
          category?: string
          city?: string
          created_at?: string
          description?: string | null
          event_date?: string
          event_time?: string
          id?: string
          image_url?: string | null
          organizer_id?: string
          scanner_token?: string
          status?: Database["public"]["Enums"]["event_status"]
          title?: string
          updated_at?: string
          venue?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          label: string
          order_id: string
          quantity: number
          seat_id: string | null
          ticket_type_id: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          order_id: string
          quantity?: number
          seat_id?: string | null
          ticket_type_id?: string | null
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          order_id?: string
          quantity?: number
          seat_id?: string | null
          ticket_type_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          event_id: string
          expires_at: string | null
          gopay_payment_id: string | null
          gopay_payment_url: string | null
          id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          superfaktura_invoice_id: string | null
          superfaktura_invoice_number: string | null
          superfaktura_invoice_pdf_url: string | null
          total_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          event_id: string
          expires_at?: string | null
          gopay_payment_id?: string | null
          gopay_payment_url?: string | null
          id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          superfaktura_invoice_id?: string | null
          superfaktura_invoice_number?: string | null
          superfaktura_invoice_pdf_url?: string | null
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          event_id?: string
          expires_at?: string | null
          gopay_payment_id?: string | null
          gopay_payment_url?: string | null
          id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          superfaktura_invoice_id?: string | null
          superfaktura_invoice_number?: string | null
          superfaktura_invoice_pdf_url?: string | null
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_logs: {
        Row: {
          created_at: string
          endpoint: string | null
          error_message: string | null
          id: string
          order_id: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          request_payload: Json | null
          response_payload: Json | null
          status: string | null
        }
        Insert: {
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          id?: string
          order_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string | null
        }
        Update: {
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          id?: string
          order_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          order_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id: string | null
          raw_response: Json | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          order_id: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id?: string | null
          raw_response?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          order_id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id?: string | null
          raw_response?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      seat_inventory: {
        Row: {
          created_at: string
          event_id: string
          id: string
          is_vip: boolean
          label: string | null
          order_id: string | null
          price: number
          reserved_until: string | null
          seat_id: string
          status: Database["public"]["Enums"]["seat_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          is_vip?: boolean
          label?: string | null
          order_id?: string | null
          price?: number
          reserved_until?: string | null
          seat_id: string
          status?: Database["public"]["Enums"]["seat_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          is_vip?: boolean
          label?: string | null
          order_id?: string | null
          price?: number
          reserved_until?: string | null
          seat_id?: string
          status?: Database["public"]["Enums"]["seat_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seat_inventory_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seat_inventory_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      superfaktura_logs: {
        Row: {
          created_at: string
          endpoint: string | null
          error_message: string | null
          id: string
          invoice_id: string | null
          order_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          status: Database["public"]["Enums"]["sf_log_status"]
        }
        Insert: {
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          order_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: Database["public"]["Enums"]["sf_log_status"]
        }
        Update: {
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          order_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: Database["public"]["Enums"]["sf_log_status"]
        }
        Relationships: [
          {
            foreignKeyName: "superfaktura_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_scans: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          qr_token: string | null
          result: Database["public"]["Enums"]["ticket_scan_result"]
          scanned_by: string | null
          scanner_name: string | null
          ticket_id: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          qr_token?: string | null
          result: Database["public"]["Enums"]["ticket_scan_result"]
          scanned_by?: string | null
          scanner_name?: string | null
          ticket_id?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          qr_token?: string | null
          result?: Database["public"]["Enums"]["ticket_scan_result"]
          scanned_by?: string | null
          scanner_name?: string | null
          ticket_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      ticket_types: {
        Row: {
          created_at: string
          event_id: string
          id: string
          name: string
          price: number
          quantity: number
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          name: string
          price?: number
          quantity?: number
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          name?: string
          price?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          allow_reentry: boolean
          event_id: string
          id: string
          issued_at: string
          last_scan_at: string | null
          order_id: string
          qr_code: string
          qr_token: string | null
          scan_count: number
          scanned_by: string | null
          seat_id: string | null
          seat_label: string
          used_at: string | null
        }
        Insert: {
          allow_reentry?: boolean
          event_id: string
          id?: string
          issued_at?: string
          last_scan_at?: string | null
          order_id: string
          qr_code: string
          qr_token?: string | null
          scan_count?: number
          scanned_by?: string | null
          seat_id?: string | null
          seat_label: string
          used_at?: string | null
        }
        Update: {
          allow_reentry?: boolean
          event_id?: string
          id?: string
          issued_at?: string
          last_scan_at?: string | null
          order_id?: string
          qr_code?: string
          qr_token?: string | null
          scan_count?: number
          scanned_by?: string | null
          seat_id?: string | null
          seat_label?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "user" | "organizer" | "admin"
      event_status: "draft" | "published"
      order_status:
        | "pending"
        | "awaiting_payment"
        | "paid"
        | "failed"
        | "cancelled"
        | "refunded"
        | "expired"
      payment_provider: "gopay"
      payment_status:
        | "pending"
        | "authorized"
        | "paid"
        | "failed"
        | "cancelled"
        | "refunded"
      seat_status: "available" | "reserved" | "sold"
      sf_log_status: "ok" | "error"
      ticket_scan_result: "valid" | "duplicate" | "invalid" | "reentry"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["user", "organizer", "admin"],
      event_status: ["draft", "published"],
      order_status: [
        "pending",
        "awaiting_payment",
        "paid",
        "failed",
        "cancelled",
        "refunded",
        "expired",
      ],
      payment_provider: ["gopay"],
      payment_status: [
        "pending",
        "authorized",
        "paid",
        "failed",
        "cancelled",
        "refunded",
      ],
      seat_status: ["available", "reserved", "sold"],
      sf_log_status: ["ok", "error"],
      ticket_scan_result: ["valid", "duplicate", "invalid", "reentry"],
    },
  },
} as const
