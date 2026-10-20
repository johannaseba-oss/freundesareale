-- Nach schema.sql ausführen. Weitere Personen einfach als weitere Zeile ergänzen.
insert into public.allowed_emails(email, note) values
  ('johanna.seba@googlemail.com', 'Johanna')
on conflict (email) do nothing;
