import type {Rule} from 'eslint'

/**
 * JSX isn't part of the ESTree spec eslint's own types cover, so this is
 * hand-declared for exactly the shapes this rule reads. Every field is
 * optional because the same loose shape stands in for every node kind this
 * rule inspects (Identifier, MemberExpression, CallExpression,
 * VariableDeclarator, JSXExpressionContainer, JSXAttribute); each call site
 * narrows it with a plain `.type` check instead of relying on a
 * discriminated union.
 *
 * `name` covers two real shapes that happen to share a property name:
 * `Identifier.name` is a plain string, but `JSXAttribute.name` is itself a
 * `JSXIdentifier` node (so `alt={x}`'s attribute name is
 * `node.parent.name.name`, not `node.parent.name`). getJsxAttributeName()
 * below is the one place that distinction matters.
 */
interface AstNode {
  type: string
  name?: string | AstNode
  value?: unknown
  computed?: boolean
  object?: AstNode
  property?: AstNode
  callee?: AstNode
  expression?: AstNode
  init?: AstNode | null
  parent?: AstNode
  body?: AstNode[]
  specifiers?: AstNode[]
  source?: AstNode
  local?: AstNode
  importKind?: string
}

/** An Identifier node's own name, narrowed from the shared `string |
 *  AstNode` field (see the AstNode doc comment for why that union exists). */
function getIdentifierName(node: AstNode): string | null {
  return typeof node.name === 'string' ? node.name : null
}

/** The property name of a member access, whether written `.username` or
 *  the computed-but-static `["username"]` (a common way to sidestep a
 *  quick eyeball read of dot-access, so it's covered on purpose). Computed
 *  access with anything other than a string literal (`user[key]`) can't be
 *  resolved statically and returns null. */
function getMemberPropertyName(node: AstNode): string | null {
  if (!node.computed && node.property?.type === 'Identifier') {
    return getIdentifierName(node.property)
  }
  if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value
  }
  return null
}

/** The attribute name of a JSXAttribute node (`alt` in `alt={x}`), or null
 *  for shapes this rule doesn't resolve statically (for example a
 *  namespaced name like `xlink:href`). */
function getJsxAttributeName(attribute: AstNode): string | null {
  const nameNode = attribute.name
  if (typeof nameNode === 'string') return nameNode
  if (nameNode?.type === 'JSXIdentifier' && typeof nameNode.name === 'string') {
    return nameNode.name
  }
  return null
}

interface AutoImportConfig {
  name: string
  source: string
}

interface RuleOptions {
  riskyNames?: string[]
  riskyAttributes?: string[]
  sanitizerNames?: string[]
  autoImport?: AutoImportConfig | false
}

const DEFAULT_RISKY_NAMES = ['username', 'handle', 'displayname', 'nickname', 'bio']
const DEFAULT_SANITIZER_NAMES = ['sanitize']
/**
 * What --fix wraps a violation in and, if needed, imports. Decoupled from
 * sanitizerNames on purpose: sanitizerNames is about recognizing an
 * already-sanitized value during the *check*, or a project may list several
 * (a local wrapper included); autoImport is about what's safe to generate
 * during the *fix*, where only one answer can be written, and it must be a
 * real export of `source` or the fix produces broken code. Set to `false` to
 * report without offering a fix, for setups too custom to automate safely.
 */
const DEFAULT_AUTO_IMPORT: AutoImportConfig = {name: 'sanitize', source: 'unicode-shield'}
/**
 * JSX attributes that render or expose their value as text (visibly, or to
 * assistive tech), the same class of sink as a JSX child. Deliberately
 * excludes event handlers (`onChange`), styling/behavior props
 * (`className`, `href`, `key`, `ref`), and anything else that isn't a text
 * sink, those would only produce false positives here.
 */
const DEFAULT_RISKY_ATTRIBUTES = ['alt', 'title', 'placeholder', 'aria-label', 'value']

function matchesAnyExact(name: string, candidates: string[]): boolean {
  const lower = name.toLowerCase()
  return candidates.some(candidate => lower === candidate.toLowerCase())
}

function matchesAny(name: string, candidates: string[]): boolean {
  const lower = name.toLowerCase()
  return candidates.some(candidate => lower.includes(candidate.toLowerCase()))
}

/**
 * The risky name this expression would be reported under, or null if this
 * shape isn't one this rule analyzes. Only a bare identifier (`{username}`)
 * or a member access with a statically known property name (`{user.username}`
 * or `{user["username"]}`) are considered; anything else (a call, a template
 * literal, a computed access with a non-literal key) is left alone. This is
 * a one-hop naming heuristic, not real data-flow analysis.
 */
function getRiskyName(node: AstNode, riskyNames: string[]): string | null {
  if (node.type === 'Identifier') {
    const name = getIdentifierName(node)
    if (name !== null && matchesAny(name, riskyNames)) return name
  }
  if (node.type === 'MemberExpression') {
    const propertyName = getMemberPropertyName(node)
    if (propertyName !== null && matchesAny(propertyName, riskyNames)) {
      return propertyName
    }
  }
  return null
}

function isSanitizerCall(node: AstNode | null | undefined, sanitizerNames: string[]): boolean {
  if (!node || node.type !== 'CallExpression' || !node.callee) return false
  const callee = node.callee
  if (callee.type === 'Identifier') {
    const name = getIdentifierName(callee)
    return name !== null && sanitizerNames.includes(name)
  }
  if (callee.type === 'MemberExpression') {
    const propertyName = getMemberPropertyName(callee)
    return propertyName !== null && sanitizerNames.includes(propertyName)
  }
  return false
}

/**
 * True when `identifier` was declared as `const x = sanitize(...)`. Only
 * chases the variable's own initializer (one hop): it doesn't follow
 * re-assignments or multi-step aliasing.
 */
function isSanitizedVariable(
  context: Rule.RuleContext,
  identifier: AstNode,
  sanitizerNames: string[],
): boolean {
  const scope = context.sourceCode.getScope(identifier as unknown as Rule.Node)
  const reference = scope.references.find(ref => (ref.identifier as unknown as AstNode) === identifier)
  const def = reference?.resolved?.defs[0]
  if (!def || def.type !== 'Variable') return false
  const declarator = def.node as unknown as AstNode
  return isSanitizerCall(declarator.init, sanitizerNames)
}

/**
 * Where a JSXExpressionContainer sits determines whether this rule looks at
 * it at all, and which one determines the risky attribute name for
 * attribute positions. `null` means "not a position this rule checks".
 */
type CheckedPosition = {kind: 'child'} | {kind: 'attribute'; attributeName: string}

function getCheckedPosition(node: AstNode, riskyAttributes: string[]): CheckedPosition | null {
  const parent = node.parent
  if (!parent) return null

  if (parent.type === 'JSXElement' || parent.type === 'JSXFragment') {
    return {kind: 'child'}
  }

  if (parent.type === 'JSXAttribute') {
    const attributeName = getJsxAttributeName(parent)
    if (attributeName !== null && matchesAnyExact(attributeName, riskyAttributes)) {
      return {kind: 'attribute', attributeName}
    }
  }

  return null
}

/**
 * What the fixer needs to do to bring autoImport's name into scope, decided
 * once per fix:
 * - already-imported: a module-scope binding named autoImport.name already
 *   exists, and it's exactly the thing we'd otherwise import: a named (not
 *   default/namespace), non-type-only specifier from exactly
 *   autoImport.source. The fixer only needs to wrap the value.
 * - unsafe: a module-scope binding named autoImport.name already exists,
 *   but it's something else entirely, a different import, a local
 *   const/function/class, a default/namespace import, or a type-only one.
 *   Inserting another binding under that name would be a duplicate
 *   declaration (a real SyntaxError, confirmed directly: ESLint's own
 *   `--fix` has no safety net that rejects a fix producing unparseable
 *   output, it writes whatever `output` it computes), and silently calling
 *   whatever's already bound to that name could run something unrelated
 *   instead of sanitizing anything. No fix is offered in this case.
 * - add-specifier: no existing binding for autoImport.name at all, but an
 *   import from `source` exists with a named ({...}) block that isn't
 *   type-only; append the name there instead of creating a second import
 *   statement from the same source.
 * - add-declaration: no existing binding for autoImport.name, and no usable
 *   value import from `source` to extend either (covers no import at all,
 *   a default/namespace-only import, and a type-only one). Inserts a fresh
 *   `import {name} from 'source'`, after the last existing import if there
 *   is one, otherwise before the file's first statement.
 */
type ImportFixPlan =
  | {kind: 'already-imported'}
  | {kind: 'unsafe'}
  | {kind: 'add-specifier'; lastSpecifier: AstNode}
  | {kind: 'add-declaration'; afterImport: AstNode | null; beforeStatement: AstNode | null}

interface ScopeDefinition {
  type: string
  node: AstNode
  parent?: AstNode | null
}

function isSanitizerImportBinding(definition: ScopeDefinition, autoImport: AutoImportConfig): boolean {
  if (definition.type !== 'ImportBinding') return false
  if (definition.node.type !== 'ImportSpecifier' || definition.node.importKind === 'type') return false
  const declaration = definition.parent
  return declaration != null && declaration.source?.value === autoImport.source && declaration.importKind !== 'type'
}

function planSanitizerImportFix(context: Rule.RuleContext, program: AstNode, autoImport: AutoImportConfig): ImportFixPlan {
  const globalScope = context.sourceCode.getScope(program as unknown as Rule.Node)
  const moduleScope = globalScope.childScopes.find(child => child.type === 'module') ?? globalScope
  const existingBinding = moduleScope.variables.find(variable => variable.name === autoImport.name)

  if (existingBinding) {
    const isExactSanitizerImport = existingBinding.defs.some(definition =>
      isSanitizerImportBinding(definition as unknown as ScopeDefinition, autoImport),
    )
    return isExactSanitizerImport ? {kind: 'already-imported'} : {kind: 'unsafe'}
  }

  const body = program.body ?? []
  let lastImportDeclaration: AstNode | null = null
  let lastNamedSpecifierFromSource: AstNode | null = null

  for (const statement of body) {
    if (statement.type !== 'ImportDeclaration') continue
    lastImportDeclaration = statement
    if (statement.source?.value !== autoImport.source || statement.importKind === 'type') continue

    const namedSpecifiers = (statement.specifiers ?? []).filter(
      specifier => specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type',
    )
    if (namedSpecifiers.length > 0) {
      lastNamedSpecifierFromSource = namedSpecifiers[namedSpecifiers.length - 1] ?? null
    }
  }

  if (lastNamedSpecifierFromSource) {
    return {kind: 'add-specifier', lastSpecifier: lastNamedSpecifierFromSource}
  }
  return {kind: 'add-declaration', afterImport: lastImportDeclaration, beforeStatement: body[0] ?? null}
}

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

// Every ES2015+ reserved word and literal keyword: none of these can be used
// as a plain identifier (an import specifier's local name, or a call
// callee) in a module, which is always strict mode. `arguments` and `eval`
// are deliberately included too: not reserved words technically, but
// strict mode (which a module always is) forbids binding either as an
// import/const-like name, confirmed directly rather than assumed.
const RESERVED_WORDS = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package',
  'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield',
])

/**
 * Whether autoImport.name is safe to splice directly into generated code as
 * a bare identifier (both the call `name(...)` and the import specifier
 * `{name}`). Guards a config typo (a package-style `sanitize-text`, a
 * leading digit, an empty string, a reserved word) from producing an
 * autofix that inserts syntactically invalid JS. This matters because
 * nothing downstream catches it: ESLint's own `--fix` writes whatever
 * `output` it computes with no check that it still parses (confirmed
 * directly against `ESLint.outputFixes`, not assumed), so this check is the
 * only thing standing between a bad config value and a corrupted file.
 */
function isSafeIdentifier(name: string): boolean {
  return VALID_IDENTIFIER.test(name) && !RESERVED_WORDS.has(name)
}

/**
 * A single-quoted JS string literal for `value`, escaped by direct
 * construction (backslash first, so it can't double-escape the characters
 * the later replacements introduce) rather than by reusing
 * JSON.stringify's double-quoted output, so the generated import's module
 * specifier can't break out of its string even if it's an unusual one
 * (containing a quote or backslash, e.g. a Windows path someone configured).
 */
function toSingleQuotedStringLiteral(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  return `'${escaped}'`
}

/**
 * Wraps the flagged expression in a call to autoImport.name, plus whatever
 * import edit `plan` calls for. Both are returned as one fix array so
 * ESLint applies them atomically; when two violations in the same file both
 * need `add-declaration`, their combined ranges overlap (both touch the same
 * insertion point) and only one wins per pass, the other converges on
 * ESLint's next pass once the import already exists. That's standard
 * multi-pass --fix behavior, not something this rule needs to work around.
 * Returns null for `unsafe`: no fix at all is safer than one that collides
 * with an existing, unrelated binding of the same name.
 */
function buildSanitizeFix(
  context: Rule.RuleContext,
  fixer: Rule.RuleFixer,
  expression: AstNode,
  plan: ImportFixPlan,
  autoImport: AutoImportConfig,
): Rule.Fix[] | null {
  if (plan.kind === 'unsafe') return null

  const expressionNode = expression as unknown as Rule.Node
  const expressionText = context.sourceCode.getText(expressionNode)
  const fixes = [fixer.replaceText(expressionNode, `${autoImport.name}(${expressionText})`)]

  if (plan.kind === 'add-specifier') {
    fixes.push(fixer.insertTextAfter(plan.lastSpecifier as unknown as Rule.Node, `, ${autoImport.name}`))
  } else if (plan.kind === 'add-declaration') {
    // The trailing `;` is deliberate even in a semicolon-free codebase: this
    // statement's own end relies on ASI, and if what follows in the file
    // happens to start with `<` (bare JSX used as a statement, or another
    // JSX-leading line), acorn-jsx doesn't reliably insert a semicolon on
    // its own there, an unterminated-import parse error results otherwise
    // (confirmed directly against espree, not theoretical).
    const importText = `import {${autoImport.name}} from ${toSingleQuotedStringLiteral(autoImport.source)};`
    if (plan.afterImport) {
      fixes.push(fixer.insertTextAfter(plan.afterImport as unknown as Rule.Node, `\n${importText}`))
    } else if (plan.beforeStatement) {
      fixes.push(fixer.insertTextBefore(plan.beforeStatement as unknown as Rule.Node, `${importText}\n\n`))
    }
  }

  return fixes
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description:
        "Require identity-like text (usernames, handles, display names, bios) rendered as JSX content or passed to a text-rendering JSX attribute (alt, title, placeholder, aria-label, value) to be passed through unicode-shield's sanitize() first",
    },
    schema: [
      {
        type: 'object',
        properties: {
          riskyNames: {type: 'array', items: {type: 'string'}},
          riskyAttributes: {type: 'array', items: {type: 'string'}},
          sanitizerNames: {type: 'array', items: {type: 'string'}},
          autoImport: {
            oneOf: [
              {const: false},
              {
                type: 'object',
                properties: {
                  name: {type: 'string'},
                  source: {type: 'string'},
                },
                required: ['name', 'source'],
                additionalProperties: false,
              },
            ],
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      requireSanitize:
        "'{{name}}' looks like user-supplied text rendered without going through unicode-shield's sanitize(). If it can contain untrusted input, wrap it: sanitize({{name}}).",
      requireSanitizeAttribute:
        "'{{name}}' looks like user-supplied text passed to the '{{attribute}}' attribute without going through unicode-shield's sanitize(). If it can contain untrusted input, wrap it: sanitize({{name}}).",
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as RuleOptions
    const riskyNames = options.riskyNames ?? DEFAULT_RISKY_NAMES
    const riskyAttributes = options.riskyAttributes ?? DEFAULT_RISKY_ATTRIBUTES
    const sanitizerNames = options.sanitizerNames ?? DEFAULT_SANITIZER_NAMES
    const configuredAutoImport = options.autoImport === false ? null : (options.autoImport ?? DEFAULT_AUTO_IMPORT)
    const autoImport = configuredAutoImport && isSafeIdentifier(configuredAutoImport.name) ? configuredAutoImport : null
    const program = context.sourceCode.ast as unknown as AstNode

    return {
      JSXExpressionContainer(rawNode: unknown) {
        const node = rawNode as AstNode
        const position = getCheckedPosition(node, riskyAttributes)
        if (!position) return

        const expression = node.expression
        if (!expression || expression.type === 'JSXEmptyExpression') return

        const riskyName = getRiskyName(expression, riskyNames)
        if (!riskyName) return

        if (expression.type === 'Identifier' && isSanitizedVariable(context, expression, sanitizerNames)) {
          return
        }

        const fix = autoImport
          ? (fixer: Rule.RuleFixer) =>
              buildSanitizeFix(
                context,
                fixer,
                expression,
                planSanitizerImportFix(context, program, autoImport),
                autoImport,
              )
          : undefined

        if (position.kind === 'attribute') {
          context.report({
            node: expression as unknown as Rule.Node,
            messageId: 'requireSanitizeAttribute',
            data: {name: riskyName, attribute: position.attributeName},
            fix,
          })
          return
        }

        context.report({
          node: expression as unknown as Rule.Node,
          messageId: 'requireSanitize',
          data: {name: riskyName},
          fix,
        })
      },
    }
  },
}

export default rule
