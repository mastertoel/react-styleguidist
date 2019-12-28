import pick from 'lodash/pick';
import flatten from 'lodash/flatten';
import { namedTypes as t, builders as b } from 'ast-types';
import commonDir from 'common-dir';
import { generate } from 'escodegen';
import toAst from 'to-ast';
import createLogger from 'glogg';
import * as fileExistsCaseInsensitive from '../scripts/utils/findFileCaseInsensitive';
import getAllContentPages from './utils/getAllContentPages';
import getComponentFilesFromSections from './utils/getComponentFilesFromSections';
import getComponentPatternsFromSections from './utils/getComponentPatternsFromSections';
import getSections from './utils/getSections';
import filterComponentsWithExample from './utils/filterComponentsWithExample';
import slugger from './utils/slugger';
import resolveES6 from './utils/resolveES6';

const logger = createLogger('rsg');

// Config options that should be passed to the client
const CLIENT_CONFIG_OPTIONS = [
	'compilerConfig',
	'mountPointId',
	'pagePerSection',
	'previewDelay',
	'ribbon',
	'showSidebar',
	'styles',
	'theme',
	'title',
	'version',
];

const StylesVariableName = '__rsgStyles';
const ThemeVariableName = '__rsgTheme';

export default function() {}
export function pitch(this: Rsg.StyleguidistLoaderContext) {
	// Clear cache so it would detect new or renamed files
	fileExistsCaseInsensitive.clearCache();

	// Reset slugger for each code reload to be deterministic
	slugger.reset();

	const config = this._styleguidist;

	let sections = getSections(config.sections, config);
	if (config.skipComponentsWithoutExample) {
		sections = filterComponentsWithExample(sections);
	}

	const allComponentFiles = getComponentFilesFromSections(
		config.sections,
		config.configDir,
		config.ignore
	);
	const allContentPages = getAllContentPages(sections);

	// Nothing to show in the style guide
	const welcomeScreen = allContentPages.length === 0 && allComponentFiles.length === 0;
	const patterns = welcomeScreen ? getComponentPatternsFromSections(config.sections) : undefined;

	logger.debug('Loading components:\n' + allComponentFiles.join('\n'));

	// Setup Webpack context dependencies to enable hot reload when adding new files
	if (config.contextDependencies) {
		config.contextDependencies.forEach((dir: string) => this.addContextDependency(dir));
	} else if (allComponentFiles.length > 0) {
		// Use common parent directory of all components as a context
		this.addContextDependency(commonDir(allComponentFiles));
	}

	const configClone = { ...config };
	const styleContext: t.VariableDeclaration[][] = [];

	const setVariableValueToObjectInFile = (
		memberName: keyof Rsg.ProcessedStyleguidistCSSConfig,
		varName: string
	) => {
		const configMember = config[memberName];
		if (typeof configMember === 'string') {
			// first attach the file as a dependency
			this.addDependency(configMember);

			// then create a variable to contain the value of the theme/style
			styleContext.push(resolveES6(configMember, varName));

			// Finally assign the calcultaed value to the member of the clone
			// NOTE: if you are mutating config without cloning it, it changes
			// the value for all config untill the process is stopped.
			// This means `config` should not be mutated during this process.
			const variableAst = {};
			// we trick the toAst() function here because we want to force the value in it
			Object.defineProperty(variableAst, 'toAST', {
				enumerable: false,
				value(): t.ASTNode {
					return b.identifier(varName);
				},
			});
			configClone[memberName] = variableAst;
		}
	};

	setVariableValueToObjectInFile('styles', StylesVariableName);
	setVariableValueToObjectInFile('theme', ThemeVariableName);

	const styleguide = {
		config: pick(configClone, CLIENT_CONFIG_OPTIONS),
		welcomeScreen,
		patterns,
		sections,
	};

	return `${generate(b.program(flatten(styleContext)))}
if (module.hot) {
	module.hot.accept([])
}
module.exports = ${generate(toAst(styleguide))}
`;
}
