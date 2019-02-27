import * as parser from './parser'
import { log } from 'fp-ts/lib/Console'
import { IO, io } from 'fp-ts/lib/IO'
import * as markdown from './markdown'
import * as path from 'path'
import * as fs from 'fs-extra'
import { tree } from 'fp-ts/lib/Tree'
import { Validation, success, failure } from 'fp-ts/lib/Validation'
import { array, sort, empty } from 'fp-ts/lib/Array'
import { ordString, contramap } from 'fp-ts/lib/Ord'
import { Option } from 'fp-ts/lib/Option'
import { fromFoldable } from 'fp-ts/lib/Record'
import { tuple, identity } from 'fp-ts/lib/function'
import { toArray } from 'fp-ts/lib/Foldable2v'
import { checkSources } from './check'

function writeFileSync(path: string, content: string): Validation<Array<string>, IO<void>> {
  try {
    return success(log(`Printing module ${path}`).applySecond(new IO(() => fs.outputFileSync(path, content))))
  } catch (e) {
    return failure([`Cannot open file ${path}: ${e}`])
  }
}

function getOutpuPath(outDir: string, node: parser.Node): string {
  return parser.fold(
    node,
    p => path.join(outDir, p.slice(1).join(path.sep) + path.sep + 'index.md'),
    p => path.join(outDir, p.slice(1).join(path.sep) + '.md')
  )
}

function getExamples(nodes: Array<parser.Node>): Record<string, string> {
  const toArray = (prefix: string, x: { name: string; example: Option<string> }): Array<[string, string]> =>
    x.example.foldL(
      () => empty,
      source => [tuple(prefix + '-' + x.name + '.ts', `import * as assert from 'assert'\n` + source)]
    )

  const sources = array.chain(nodes, node => {
    switch (node.type) {
      case 'Index':
        return empty
      case 'Module':
        return array.chain(node.functions, f => toArray(node.path.join('-'), f))
    }
  })
  return fromFoldable(array)(sources, identity)
}

function checkExamples(nodes: Array<parser.Node>): Validation<Array<string>, void> {
  const examples = getExamples(nodes)
  const failures = checkSources(examples)
  if (failures.length > 0) {
    return failure(failures.map(f => f.message))
  } else {
    return success(undefined)
  }
}

/**
 * @since 0.0.1
 */
export function main(pattern: string, outDir: string): IO<void> {
  let counter = 1

  function writeNode(node: parser.Node): Validation<Array<string>, IO<void>> {
    switch (node.type) {
      case 'Index':
        return success(log(`Detected directory ${node.path.join('/')}`))
      case 'Module':
        const header = markdown.header(node.path.slice(1).join('/'), counter++)
        return writeFileSync(getOutpuPath(outDir, node), header + markdown.run(node))
    }
  }

  return parser.monadValidation
    .chain(parser.run(pattern), forest => {
      const nodes = array.chain(forest, t => toArray(tree)(t))
      return parser.monadValidation.chain(checkExamples(nodes), () => {
        const sorted = sort(contramap((node: parser.Node) => node.path.join('/').toLowerCase(), ordString))(nodes)
        return array.traverse(parser.monadValidation)(sorted, writeNode)
      })
    })
    .map(a =>
      array
        .sequence(io)(a)
        .map(() => undefined)
    )
    .fold(
      errors => log(`Errors: ${errors.join('\n')}`).applySecond(new IO(() => process.exit(1))),
      a => a.map(() => undefined)
    )
}
