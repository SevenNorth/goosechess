import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

const workspaceRoot = resolve(import.meta.dirname, '..')
const packageRules = {
  'game-core': new Set(),
  'game-content': new Set(['@goose-chess/game-core']),
  'game-ai': new Set(['@goose-chess/game-core']),
  'game-protocol': new Set(['@goose-chess/game-core', 'zod']),
}

const violations = []

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  })
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

for (const [directoryName, allowedDependencies] of Object.entries(packageRules)) {
  const packageRoot = resolve(workspaceRoot, 'packages', directoryName)
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (!allowedDependencies.has(dependency)) {
      violations.push(`${directoryName}/package.json: runtime dependency ${dependency} is not allowed`)
    }
  }

  for (const file of sourceFiles(resolve(packageRoot, 'src'))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const inspect = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier)
          if (relative(packageRoot, target).startsWith('..')) {
            violations.push(`${relative(workspaceRoot, file)}: relative import leaves its package (${specifier})`)
          }
        } else if (!allowedDependencies.has(packageName(specifier))) {
          violations.push(`${relative(workspaceRoot, file)}: import ${specifier} is not allowed`)
        }
      }
      ts.forEachChild(node, inspect)
    }
    inspect(source)
  }
}

if (violations.length) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log('Package dependency boundaries are valid.')
}
