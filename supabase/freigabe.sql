-- Nach schema.sql ausführen. Weitere Personen einfach als weitere Zeile ergänzen.
insert into public.allowed_emails(email, note) values
  ('johanna.seba@googlemail.com', 'Johanna'),
  ('selja.seba@googlemail.com', 'Selja')
on conflict (email) do nothing;
