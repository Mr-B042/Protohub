-- Migration 010: add Manager and Viewer to user_role enum
-- These roles exist in the frontend permission map but were missing from the DB
-- enum, meaning any attempt to store them would fail at the DB level.

alter type user_role add value if not exists 'Manager';
alter type user_role add value if not exists 'Viewer';
