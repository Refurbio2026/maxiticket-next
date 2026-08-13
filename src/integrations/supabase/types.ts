export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      email_logs: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          order_id: string | null;
          provider: string;
          provider_message_id: string | null;
          recipient: string;
          status: Database["public"]["Enums"]["sf_log_status"];
          subject: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          order_id?: string | null;
          provider?: string;
          provider_message_id?: string | null;
          recipient: string;
          status: Database["public"]["Enums"]["sf_log_status"];
          subject: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          order_id?: string | null;
          provider?: string;
          provider_message_id?: string | null;
          recipient?: string;
          status?: Database["public"]["Enums"]["sf_log_status"];
          subject?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_logs_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          address: string | null;
          base_price: number | null;
          category: string;
          city: string;
          created_at: string;
          description: string | null;
          event_date: string;
          event_time: string;
          id: string;
          image_url: string | null;
          organizer_id: string;
          sale_type: Database["public"]["Enums"]["sale_type"];
          scanner_token: string;
          status: Database["public"]["Enums"]["event_status"];
          title: string;
          total_tickets: number | null;
          updated_at: string;
          venue: string;
          venue_id: string | null;
          venue_layout_id: string | null;
          vip_price: number | null;
        };
        Insert: {
          address?: string | null;
          base_price?: number | null;
          category: string;
          city: string;
          created_at?: string;
          description?: string | null;
          event_date: string;
          event_time: string;
          id?: string;
          image_url?: string | null;
          organizer_id: string;
          sale_type?: Database["public"]["Enums"]["sale_type"];
          scanner_token?: string;
          status?: Database["public"]["Enums"]["event_status"];
          title: string;
          total_tickets?: number | null;
          updated_at?: string;
          venue: string;
          venue_id?: string | null;
          venue_layout_id?: string | null;
          vip_price?: number | null;
        };
        Update: {
          address?: string | null;
          base_price?: number | null;
          category?: string;
          city?: string;
          created_at?: string;
          description?: string | null;
          event_date?: string;
          event_time?: string;
          id?: string;
          image_url?: string | null;
          organizer_id?: string;
          sale_type?: Database["public"]["Enums"]["sale_type"];
          scanner_token?: string;
          status?: Database["public"]["Enums"]["event_status"];
          title?: string;
          total_tickets?: number | null;
          updated_at?: string;
          venue?: string;
          venue_id?: string | null;
          venue_layout_id?: string | null;
          vip_price?: number | null;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          label: string;
          order_id: string;
          quantity: number;
          seat_id: string | null;
          ticket_type_id: string | null;
          unit_price: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
          order_id: string;
          quantity?: number;
          seat_id?: string | null;
          ticket_type_id?: string | null;
          unit_price?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
          order_id?: string;
          quantity?: number;
          seat_id?: string | null;
          ticket_type_id?: string | null;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_ticket_type_id_fkey";
            columns: ["ticket_type_id"];
            isOneToOne: false;
            referencedRelation: "ticket_types";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          created_at: string;
          currency: string;
          customer_email: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          cashier_id: string | null;
          channel: string;
          coupon_id: string | null;
          discount_amount: number;
          fiscal_receipt_id: string | null;
          payment_method: string | null;
          pos_session_id: string | null;
          promo_code: string | null;
          receipt_number: string | null;
          void_reason: string | null;
          event_id: string;
          event_date_id: string;
          expires_at: string | null;
          gopay_payment_id: string | null;
          gopay_payment_url: string | null;
          id: string;
          paid_at: string | null;
          status: Database["public"]["Enums"]["order_status"];
          superfaktura_invoice_id: string | null;
          superfaktura_invoice_number: string | null;
          superfaktura_invoice_pdf_url: string | null;
          tickets_emailed_at: string | null;
          total_amount: number;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          cashier_id?: string | null;
          channel?: string;
          coupon_id?: string | null;
          discount_amount?: number;
          fiscal_receipt_id?: string | null;
          payment_method?: string | null;
          pos_session_id?: string | null;
          promo_code?: string | null;
          receipt_number?: string | null;
          void_reason?: string | null;
          event_id: string;
          event_date_id: string;
          expires_at?: string | null;
          gopay_payment_id?: string | null;
          gopay_payment_url?: string | null;
          id?: string;
          paid_at?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          superfaktura_invoice_id?: string | null;
          superfaktura_invoice_number?: string | null;
          superfaktura_invoice_pdf_url?: string | null;
          tickets_emailed_at?: string | null;
          total_amount?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          currency?: string;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          cashier_id?: string | null;
          channel?: string;
          coupon_id?: string | null;
          discount_amount?: number;
          fiscal_receipt_id?: string | null;
          payment_method?: string | null;
          pos_session_id?: string | null;
          promo_code?: string | null;
          receipt_number?: string | null;
          void_reason?: string | null;
          event_id?: string;
          event_date_id?: string;
          expires_at?: string | null;
          gopay_payment_id?: string | null;
          gopay_payment_url?: string | null;
          id?: string;
          paid_at?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          superfaktura_invoice_id?: string | null;
          superfaktura_invoice_number?: string | null;
          superfaktura_invoice_pdf_url?: string | null;
          tickets_emailed_at?: string | null;
          total_amount?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_logs: {
        Row: {
          created_at: string;
          endpoint: string | null;
          error_message: string | null;
          id: string;
          order_id: string | null;
          provider: Database["public"]["Enums"]["payment_provider"];
          request_payload: Json | null;
          response_payload: Json | null;
          status: string | null;
        };
        Insert: {
          created_at?: string;
          endpoint?: string | null;
          error_message?: string | null;
          id?: string;
          order_id?: string | null;
          provider?: Database["public"]["Enums"]["payment_provider"];
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: string | null;
        };
        Update: {
          created_at?: string;
          endpoint?: string | null;
          error_message?: string | null;
          id?: string;
          order_id?: string | null;
          provider?: Database["public"]["Enums"]["payment_provider"];
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_logs_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          order_id: string;
          provider: Database["public"]["Enums"]["payment_provider"];
          provider_payment_id: string | null;
          raw_response: Json | null;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency?: string;
          id?: string;
          order_id: string;
          provider?: Database["public"]["Enums"]["payment_provider"];
          provider_payment_id?: string | null;
          raw_response?: Json | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          order_id?: string;
          provider?: Database["public"]["Enums"]["payment_provider"];
          provider_payment_id?: string | null;
          raw_response?: Json | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          default_commission_rate: number;
          id: boolean;
          updated_at: string;
        };
        Insert: {
          default_commission_rate?: number;
          id?: boolean;
          updated_at?: string;
        };
        Update: {
          default_commission_rate?: number;
          id?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          billing_address: string | null;
          commission_rate: number | null;
          company_name: string | null;
          created_at: string;
          dic: string | null;
          full_name: string | null;
          ic_dph: string | null;
          ico: string | null;
          id: string;
          payout_iban: string | null;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          billing_address?: string | null;
          commission_rate?: number | null;
          company_name?: string | null;
          created_at?: string;
          dic?: string | null;
          full_name?: string | null;
          ic_dph?: string | null;
          ico?: string | null;
          id: string;
          payout_iban?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          billing_address?: string | null;
          commission_rate?: number | null;
          company_name?: string | null;
          created_at?: string;
          dic?: string | null;
          full_name?: string | null;
          ic_dph?: string | null;
          ico?: string | null;
          id?: string;
          payout_iban?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      settlements: {
        Row: {
          commission_amount: number;
          commission_rate: number;
          created_at: string;
          created_by: string | null;
          event_id: string | null;
          gross_amount: number;
          id: string;
          net_amount: number;
          note: string | null;
          organizer_id: string;
          paid_at: string | null;
          payout_reference: string | null;
          period_from: string;
          period_to: string;
          refunded_amount: number;
          status: "draft" | "approved" | "paid";
          tickets_sold: number;
          updated_at: string;
        };
        Insert: {
          commission_amount?: number;
          commission_rate?: number;
          created_at?: string;
          created_by?: string | null;
          event_id?: string | null;
          gross_amount?: number;
          id?: string;
          net_amount?: number;
          note?: string | null;
          organizer_id: string;
          paid_at?: string | null;
          payout_reference?: string | null;
          period_from: string;
          period_to: string;
          refunded_amount?: number;
          status?: "draft" | "approved" | "paid";
          tickets_sold?: number;
          updated_at?: string;
        };
        Update: {
          commission_amount?: number;
          commission_rate?: number;
          created_at?: string;
          created_by?: string | null;
          event_id?: string | null;
          gross_amount?: number;
          id?: string;
          net_amount?: number;
          note?: string | null;
          organizer_id?: string;
          paid_at?: string | null;
          payout_reference?: string | null;
          period_from?: string;
          period_to?: string;
          refunded_amount?: number;
          status?: "draft" | "approved" | "paid";
          tickets_sold?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settlements_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      seat_inventory: {
        Row: {
          created_at: string;
          event_id: string;
          event_date_id: string;
          id: string;
          is_vip: boolean;
          label: string | null;
          order_id: string | null;
          price: number;
          reserved_until: string | null;
          seat_id: string;
          status: Database["public"]["Enums"]["seat_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          event_date_id: string;
          id?: string;
          is_vip?: boolean;
          label?: string | null;
          order_id?: string | null;
          price?: number;
          reserved_until?: string | null;
          seat_id: string;
          status?: Database["public"]["Enums"]["seat_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          event_date_id?: string;
          id?: string;
          is_vip?: boolean;
          label?: string | null;
          order_id?: string | null;
          price?: number;
          reserved_until?: string | null;
          seat_id?: string;
          status?: Database["public"]["Enums"]["seat_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seat_inventory_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "seat_inventory_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      superfaktura_logs: {
        Row: {
          created_at: string;
          endpoint: string | null;
          error_message: string | null;
          id: string;
          invoice_id: string | null;
          order_id: string | null;
          request_payload: Json | null;
          response_payload: Json | null;
          status: Database["public"]["Enums"]["sf_log_status"];
        };
        Insert: {
          created_at?: string;
          endpoint?: string | null;
          error_message?: string | null;
          id?: string;
          invoice_id?: string | null;
          order_id?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: Database["public"]["Enums"]["sf_log_status"];
        };
        Update: {
          created_at?: string;
          endpoint?: string | null;
          error_message?: string | null;
          id?: string;
          invoice_id?: string | null;
          order_id?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          status?: Database["public"]["Enums"]["sf_log_status"];
        };
        Relationships: [
          {
            foreignKeyName: "superfaktura_logs_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_scans: {
        Row: {
          created_at: string;
          event_id: string | null;
          id: string;
          qr_token: string | null;
          result: Database["public"]["Enums"]["ticket_scan_result"];
          scanned_by: string | null;
          scanner_name: string | null;
          ticket_id: string | null;
          user_agent: string | null;
        };
        Insert: {
          created_at?: string;
          event_id?: string | null;
          id?: string;
          qr_token?: string | null;
          result: Database["public"]["Enums"]["ticket_scan_result"];
          scanned_by?: string | null;
          scanner_name?: string | null;
          ticket_id?: string | null;
          user_agent?: string | null;
        };
        Update: {
          created_at?: string;
          event_id?: string | null;
          id?: string;
          qr_token?: string | null;
          result?: Database["public"]["Enums"]["ticket_scan_result"];
          scanned_by?: string | null;
          scanner_name?: string | null;
          ticket_id?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      ticket_types: {
        Row: {
          created_at: string;
          event_id: string;
          id: string;
          name: string;
          price: number;
          quantity: number;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          id?: string;
          name: string;
          price?: number;
          quantity?: number;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          id?: string;
          name?: string;
          price?: number;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          allow_reentry: boolean;
          event_id: string;
          event_date_id: string;
          id: string;
          issued_at: string;
          last_scan_at: string | null;
          order_id: string;
          qr_code: string;
          qr_token: string | null;
          scan_count: number;
          scanned_by: string | null;
          seat_id: string | null;
          seat_label: string;
          refunded_at: string | null;
          used_at: string | null;
        };
        Insert: {
          allow_reentry?: boolean;
          event_id: string;
          event_date_id: string;
          id?: string;
          issued_at?: string;
          last_scan_at?: string | null;
          order_id: string;
          qr_code: string;
          qr_token?: string | null;
          scan_count?: number;
          scanned_by?: string | null;
          seat_id?: string | null;
          seat_label: string;
          refunded_at?: string | null;
          used_at?: string | null;
        };
        Update: {
          allow_reentry?: boolean;
          event_id?: string;
          event_date_id?: string;
          id?: string;
          issued_at?: string;
          last_scan_at?: string | null;
          order_id?: string;
          qr_code?: string;
          qr_token?: string | null;
          scan_count?: number;
          scanned_by?: string | null;
          seat_id?: string | null;
          seat_label?: string;
          refunded_at?: string | null;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      venue_layouts: {
        Row: {
          address: string | null;
          capacity: number | null;
          city: string | null;
          created_at: string;
          curve_groups: Json;
          id: string;
          name: string;
          note: string | null;
          owner_id: string | null;
          shapes: Json;
          type: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          capacity?: number | null;
          city?: string | null;
          created_at?: string;
          curve_groups?: Json;
          id?: string;
          name: string;
          note?: string | null;
          owner_id?: string | null;
          shapes?: Json;
          type?: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          capacity?: number | null;
          city?: string | null;
          created_at?: string;
          curve_groups?: Json;
          id?: string;
          name?: string;
          note?: string | null;
          owner_id?: string | null;
          shapes?: Json;
          type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pos_cashiers: {
        Row: {
          created_at: string;
          display_name: string;
          first_name: string;
          id: string;
          last_name: string;
          organizer_id: string;
          permissions: string[];
          pin_hash: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          first_name: string;
          id?: string;
          last_name: string;
          organizer_id: string;
          permissions?: string[];
          pin_hash: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          first_name?: string;
          id?: string;
          last_name?: string;
          organizer_id?: string;
          permissions?: string[];
          pin_hash?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pos_sessions: {
        Row: {
          cashier_id: string;
          closed_at: string | null;
          closing_cash: number | null;
          id: string;
          note: string | null;
          opened_at: string;
          opening_cash: number;
          organizer_id: string;
          status: string;
        };
        Insert: {
          cashier_id: string;
          closed_at?: string | null;
          closing_cash?: number | null;
          id?: string;
          note?: string | null;
          opened_at?: string;
          opening_cash?: number;
          organizer_id: string;
          status?: string;
        };
        Update: {
          cashier_id?: string;
          closed_at?: string | null;
          closing_cash?: number | null;
          id?: string;
          note?: string | null;
          opened_at?: string;
          opening_cash?: number;
          organizer_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pos_sessions_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "pos_cashiers";
            referencedColumns: ["id"];
          },
        ];
      };
      pos_closings: {
        Row: {
          card_total: number;
          cash_difference: number | null;
          cash_total: number;
          cashier_id: string | null;
          counted_cash: number | null;
          created_at: string;
          created_by: string | null;
          free_total: number;
          gross_total: number;
          id: string;
          note: string | null;
          opening_cash: number;
          orders_count: number;
          organizer_id: string;
          period_from: string;
          period_to: string;
          session_id: string | null;
          tickets_count: number;
          transfer_total: number;
          voided_count: number;
          voided_total: number;
        };
        Insert: {
          card_total?: number;
          cash_difference?: number | null;
          cash_total?: number;
          cashier_id?: string | null;
          counted_cash?: number | null;
          created_at?: string;
          created_by?: string | null;
          free_total?: number;
          gross_total?: number;
          id?: string;
          note?: string | null;
          opening_cash?: number;
          orders_count?: number;
          organizer_id: string;
          period_from: string;
          period_to: string;
          session_id?: string | null;
          tickets_count?: number;
          transfer_total?: number;
          voided_count?: number;
          voided_total?: number;
        };
        Update: {
          card_total?: number;
          cash_difference?: number | null;
          cash_total?: number;
          cashier_id?: string | null;
          counted_cash?: number | null;
          created_at?: string;
          created_by?: string | null;
          free_total?: number;
          gross_total?: number;
          id?: string;
          note?: string | null;
          opening_cash?: number;
          orders_count?: number;
          organizer_id?: string;
          period_from?: string;
          period_to?: string;
          session_id?: string | null;
          tickets_count?: number;
          transfer_total?: number;
          voided_count?: number;
          voided_total?: number;
        };
        Relationships: [];
      };
      pos_receipt_counters: {
        Row: { last_number: number; organizer_id: string; year: number };
        Insert: { last_number?: number; organizer_id: string; year: number };
        Update: { last_number?: number; organizer_id?: string; year?: number };
        Relationships: [];
      };
      coupons: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          discount_type: string;
          discount_value: number;
          event_id: string | null;
          id: string;
          max_uses: number | null;
          max_uses_per_email: number | null;
          min_order_amount: number;
          note: string | null;
          organizer_id: string | null;
          status: string;
          updated_at: string;
          used_count: number;
          valid_from: string | null;
          valid_until: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          discount_type?: string;
          discount_value: number;
          event_id?: string | null;
          id?: string;
          max_uses?: number | null;
          max_uses_per_email?: number | null;
          min_order_amount?: number;
          note?: string | null;
          organizer_id?: string | null;
          status?: string;
          updated_at?: string;
          used_count?: number;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          discount_type?: string;
          discount_value?: number;
          event_id?: string | null;
          id?: string;
          max_uses?: number | null;
          max_uses_per_email?: number | null;
          min_order_amount?: number;
          note?: string | null;
          organizer_id?: string | null;
          status?: string;
          updated_at?: string;
          used_count?: number;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coupons_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      coupon_redemptions: {
        Row: {
          coupon_id: string;
          created_at: string;
          discount_amount: number;
          email: string | null;
          id: string;
          order_id: string | null;
        };
        Insert: {
          coupon_id: string;
          created_at?: string;
          discount_amount?: number;
          email?: string | null;
          id?: string;
          order_id?: string | null;
        };
        Update: {
          coupon_id?: string;
          created_at?: string;
          discount_amount?: number;
          email?: string | null;
          id?: string;
          order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      email_templates: {
        Row: {
          created_at: string;
          enabled: boolean;
          html: string;
          key: string;
          name: string;
          subject: string;
          text_body: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          html: string;
          key: string;
          name: string;
          subject: string;
          text_body?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          html?: string;
          key?: string;
          name?: string;
          subject?: string;
          text_body?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      scanner_devices: {
        Row: {
          created_at: string;
          device_type: string;
          event_id: string | null;
          id: string;
          last_seen_at: string | null;
          location: string | null;
          name: string;
          note: string | null;
          organizer_id: string;
          serial_number: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          device_type?: string;
          event_id?: string | null;
          id?: string;
          last_seen_at?: string | null;
          location?: string | null;
          name: string;
          note?: string | null;
          organizer_id: string;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          device_type?: string;
          event_id?: string | null;
          id?: string;
          last_seen_at?: string | null;
          location?: string | null;
          name?: string;
          note?: string | null;
          organizer_id?: string;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scanner_devices_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      refund_reasons: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          organizer_fault: boolean;
          requires_note: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          organizer_fault?: boolean;
          requires_note?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          organizer_fault?: boolean;
          requires_note?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      event_categories: {
        Row: {
          active: boolean;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      performers: {
        Row: {
          active: boolean;
          bio: string | null;
          city: string | null;
          created_at: string;
          genre: string | null;
          id: string;
          image_url: string | null;
          name: string;
          slug: string;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          active?: boolean;
          bio?: string | null;
          city?: string | null;
          created_at?: string;
          genre?: string | null;
          id?: string;
          image_url?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          active?: boolean;
          bio?: string | null;
          city?: string | null;
          created_at?: string;
          genre?: string | null;
          id?: string;
          image_url?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      event_performers: {
        Row: {
          created_at: string;
          event_id: string;
          performer_id: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          performer_id: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          performer_id?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      event_dates: {
        Row: {
          created_at: string;
          event_date: string;
          event_id: string;
          event_time: string;
          id: string;
          note: string | null;
          status: string;
          total_tickets: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          event_date: string;
          event_id: string;
          event_time: string;
          id?: string;
          note?: string | null;
          status?: string;
          total_tickets?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          event_date?: string;
          event_id?: string;
          event_time?: string;
          id?: string;
          note?: string | null;
          status?: string;
          total_tickets?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_dates_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      venues: {
        Row: {
          address: string | null;
          city: string;
          created_at: string;
          default_layout_id: string | null;
          id: string;
          name: string;
          note: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          city: string;
          created_at?: string;
          default_layout_id?: string | null;
          id?: string;
          name: string;
          note?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          city?: string;
          created_at?: string;
          default_layout_id?: string | null;
          id?: string;
          name?: string;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "venues_default_layout_id_fkey";
            columns: ["default_layout_id"];
            isOneToOne: false;
            referencedRelation: "venue_layouts";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      reserve_seats: {
        Args: {
          p_event_id: string;
          p_event_date_id: string;
          p_order_id: string;
          p_reserved_until: string;
          p_seats: Json;
        };
        Returns: undefined;
      };
      next_receipt_number: {
        Args: {
          p_organizer_id: string;
        };
        Returns: string;
      };
      check_coupon: {
        Args: {
          p_code: string;
          p_event_id: string | null;
          p_amount: number;
          p_email?: string | null;
          p_claim?: boolean;
        };
        Returns: { coupon_id: string | null; discount: number; error_code: string | null }[];
      };
      release_coupon: {
        Args: {
          p_coupon_id: string;
        };
        Returns: undefined;
      };
      touch_scanner_device: {
        Args: {
          p_device_id: string;
        };
        Returns: undefined;
      };
      expire_stale_orders: {
        Args: Record<string, never>;
        Returns: number;
      };
      hit_rate_limit: {
        Args: {
          p_bucket: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      settlement_status: "draft" | "approved" | "paid";
      app_role: "user" | "organizer" | "admin";
      event_status: "draft" | "published";
      order_status:
        | "pending"
        | "awaiting_payment"
        | "paid"
        | "failed"
        | "cancelled"
        | "refunded"
        | "expired";
      payment_provider: "gopay";
      payment_status: "pending" | "authorized" | "paid" | "failed" | "cancelled" | "refunded";
      sale_type: "standing" | "seating" | "seating_map";
      seat_status: "available" | "reserved" | "sold";
      sf_log_status: "ok" | "error";
      ticket_scan_result: "valid" | "duplicate" | "invalid" | "reentry" | "refunded";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

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
      payment_status: ["pending", "authorized", "paid", "failed", "cancelled", "refunded"],
      sale_type: ["standing", "seating", "seating_map"],
      seat_status: ["available", "reserved", "sold"],
      sf_log_status: ["ok", "error"],
      ticket_scan_result: ["valid", "duplicate", "invalid", "reentry", "refunded"],
    },
  },
} as const;
