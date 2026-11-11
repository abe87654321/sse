UPDATE users SET password_hash = '!' WHERE password_hash IN ('scim_managed_no_pwd','mdm_managed_no_pwd','');
