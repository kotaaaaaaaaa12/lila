#!/usr/bin/env python3
"""Validate the reviewed upstream source and prepare an isolated container build."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
lock = json.loads((root / 'cloudflare/source-lock.json').read_text())
for name, expected in lock['reviewed_files'].items():
    path = root / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Unsupported upstream source: {name}. Use lila commit {lock["lila"]} before applying this overlay.')


def replace(name, before, after):
    path = root / name
    contents = path.read_text()
    if contents.count(before) != 1:
        raise SystemExit(f'Patch context changed in {name}; refusing a partial patch.')
    path.write_text(contents.replace(before, after))


# Keep native password hashing, username rules, rate limits, cookies, and two-factor authentication.
replace('modules/security/src/main/SecurityForm.scala',
        '    val emailField: Mapping[EmailAddress] = fullyValidEmail(using none)',
        '    private val localAccounts = sys.env.get("LOCAL_ACCOUNTS").contains("true")\n'
        '    val emailField: Mapping[EmailAddress] =\n'
        '      if localAccounts then ignored(EmailAddress("local@users.invalid"))\n'
        '      else fullyValidEmail(using none)')
replace('modules/security/src/main/SecurityForm.scala',
        '          .verifying(PasswordCheck.errorSame, x => x.password != x.username.value)',
        '          .transform[SignupData](\n'
        '            data => if localAccounts then data.copy(email = EmailAddress(s"${data.username.id.value}@users.invalid")) else data,\n'
        '            data => data\n'
        '          )\n'
        '          .verifying(PasswordCheck.errorSame, x => x.password != x.username.value)')
replace('modules/security/src/main/Signup.scala',
        '      if !canSendEmails.get() then fuccess(NoCantSend)',
        '      if sys.env.get("LOCAL_ACCOUNTS").contains("true") || !canSendEmails.get() then fuccess(NoCantSend)')
replace('app/controllers/Auth.scala',
        '    garbageCollect(user)(email)\n    if sendWelcomeEmail then env.mailer.automaticEmail.welcomeEmail(user, email)',
        '    if !sys.env.get("LOCAL_ACCOUNTS").contains("true") then\n'
        '      garbageCollect(user)(email)\n'
        '      if sendWelcomeEmail then env.mailer.automaticEmail.welcomeEmail(user, email)')

ui_name = 'modules/web/src/main/ui/AuthUi.scala'
replace(ui_name, '  import helpers.{ *, given }',
        '  import helpers.{ *, given }\n'
        '  private val localAccounts = sys.env.get("LOCAL_ACCOUNTS").contains("true")')
replace(ui_name,
        '''            form3.group(
              form("email"),
              trans.site.email(),
              help = simple.not.option(trans.site.signupEmailPromise())
            ): f =>
              div(cls := "text-wrapper")(
                form3.input(f, typ = "email")(required),
                clearFieldButton
              ),''',
        '''            if localAccounts then emptyFrag
            else form3.group(
              form("email"),
              trans.site.email(),
              help = simple.not.option(trans.site.signupEmailPromise())
            ): f =>
              div(cls := "text-wrapper")(
                form3.input(f, typ = "email")(required),
                clearFieldButton
              ),''')
replace(ui_name, 'form3.group(form("username"), trans.site.usernameOrEmail()): f =>',
        'form3.group(form("username"), if localAccounts then trans.site.username() else trans.site.usernameOrEmail()): f =>')
replace(ui_name, '              div(cls := "password-reset")(\n',
        '              (!localAccounts).option(div(cls := "password-reset")(\n')
replace(ui_name,
        '''              (!localAccounts).option(div(cls := "password-reset")(
                a(href := routes.Auth.passwordReset)(trans.site.passwordReset())
              ),''',
        '''              (!localAccounts).option(div(cls := "password-reset")(
                a(href := routes.Auth.passwordReset)(trans.site.passwordReset())
              )),''')
replace(ui_name,
        '''          div(cls := "or-separator")(span(trans.site.orSeparator())),
          a(href := addReferrer(routes.Auth.magicLink.url), cls := "button button-empty magic-link")(
            trans.site.logInByEmail()
          )''',
        '''          (!localAccounts).option(frag(
            div(cls := "or-separator")(span(trans.site.orSeparator())),
            a(href := addReferrer(routes.Auth.magicLink.url), cls := "button button-empty magic-link")(
              trans.site.logInByEmail()
            )
          ))''')

# A real version resource prevents missing or recursive configuration includes.
(root / 'conf/version.conf').write_text(
    f'app.version.commit = "{lock["lila"]}"\napp.version.date = "2026-10-14T07:45:56Z"\n')
(root / '.sbtopts').write_text(
    '-J-Xms128m\n-J-Xmx8g\n-J-Xss2m\n-J-XX:ReservedCodeCacheSize=384m\n-Dsbt.banner=false\n')
print('Reviewed source validated; local account patches and build configuration prepared.')
