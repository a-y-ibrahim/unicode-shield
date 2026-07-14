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

interface RuleOptions {
  riskyNames?: string[]
  riskyAttributes?: string[]
  sanitizerNames?: string[]
}

const DEFAULT_RISKY_NAMES = ['username', 'handle', 'displayname', 'nickname', 'bio']
const DEFAULT_SANITIZER_NAMES = ['sanitize']
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

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
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

        if (position.kind === 'attribute') {
          context.report({
            node: expression as unknown as Rule.Node,
            messageId: 'requireSanitizeAttribute',
            data: {name: riskyName, attribute: position.attributeName},
          })
          return
        }

        context.report({
          node: expression as unknown as Rule.Node,
          messageId: 'requireSanitize',
          data: {name: riskyName},
        })
      },
    }
  },
}

export default rule
