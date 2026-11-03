-- Lets a Site Admin "delete" a promo code from stripe-billing's
-- list_promo_codes/create_promo_code admin UI. A real hard delete
-- would cascade-delete promo_code_redemptions (75_promo_codes.sql's
-- `on delete cascade`), destroying the discount/revenue history for
-- every church that already redeemed it -- the same reason this app
-- soft-deletes tenants instead of dropping them. "Delete" here
-- deactivates the Stripe Promotion Code (same Stripe call as Pause)
-- and hides the row from the admin list; its redemption history stays
-- intact and still joinable (Churches tab, listPromoCodeRedemptions).
alter table public.promo_codes add column if not exists deleted_at timestamptz;
