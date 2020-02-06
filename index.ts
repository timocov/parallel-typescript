#!/usr/bin/env node

import * as childProcess from 'child_process';
import { Worker } from 'worker_threads';
import * as path from 'path';

import * as ts from 'typescript';

const enum ProjectState {
	WaitForDeps,
	ReadyToBuild,
	Building,
	Built,
}

function assert(val: boolean, msg: string): void {
	if (!val) {
		console.error(msg);
		process.exit(1);
	}
}

class ProjectsTree {
	private projectsState = new Map<string, ProjectState>();
	private dependenciesForProject = new Map<string, string[]>();

	public getBuildFlow(): number[] {
		const copy = new ProjectsTree();
		copy.projectsState = new Map(this.projectsState);
		copy.dependenciesForProject = new Map(this.dependenciesForProject);

		const result = [];
		while (!copy.areAllProjectsBuilt()) {
			const projectsToBuild = copy.takeProjectsReadyToBuild();
			result.push(projectsToBuild.length);
			projectsToBuild.forEach(copy.setProjectBuilt, copy);
		}

		return result;
	}

	public projectsCount(): number {
		return this.projectsState.size;
	}

	public addProjectWithDeps(projectPath: string, projDeps: string[]): void {
		this.dependenciesForProject.set(projectPath, projDeps.slice());
		this.updateProjectsState();
	}

	public validateState(): void {
		this.dependenciesForProject.forEach((deps: string[], projectPath: string) => {
			assert(this.projectsState.get(projectPath) !== undefined, `Cannot find state for ${projectPath}`);

			deps.forEach((depPath: string) => {
				assert(this.projectsState.get(depPath) !== undefined, `Cannot find state for ${depPath}`);
			});
		});
	}

	public takeProjectsReadyToBuild(): string[] {
		this.updateProjectsState();
		const result: string[] = [];
		this.projectsState.forEach((state: ProjectState, projectPath: string) => {
			if (state === ProjectState.ReadyToBuild) {
				result.push(projectPath);
			}
		});

		for (const projectPath of result) {
			this.projectsState.set(projectPath, ProjectState.Building);
		}

		return result;
	}

	public setProjectBuilt(projectPath: string): void {
		assert(this.projectsState.get(projectPath) === ProjectState.Building, `State of ${projectPath} is not building`);
		this.projectsState.set(projectPath, ProjectState.Built);
		this.updateProjectsState();
	}

	public areAllProjectsBuilt(): boolean {
		let result = true;

		this.projectsState.forEach((state: ProjectState) => {
			result = result && state === ProjectState.Built;
		});

		return result;
	}

	private updateProjectsState(): void {
		this.dependenciesForProject.forEach((deps: string[], projectPath: string) => {
			const currentState = this.projectsState.get(projectPath);
			if (currentState === ProjectState.Built || currentState === ProjectState.Building) {
				return;
			}

			const allDepsAreBuilt = deps.every((depPath: string) => this.projectsState.get(depPath) === ProjectState.Built);
			this.projectsState.set(projectPath, allDepsAreBuilt ? ProjectState.ReadyToBuild : ProjectState.WaitForDeps);
		});
	}
}

function durationToStr(durInMs: number): string {
	return `${(durInMs / 1000).toFixed(2)}s`;
}

function buildInParallel(projectsTree: ProjectsTree, startTime: number): void {
	if (projectsTree.areAllProjectsBuilt()) {
		console.log(`${projectsTree.projectsCount()} projects are compiled successfully in ${durationToStr(Date.now() - startTime)}`);
		return;
	}

	const projectsToBuild = projectsTree.takeProjectsReadyToBuild();
	if (projectsToBuild.length === 0) {
		return;
	}

	for (const project of projectsToBuild) {
		const projectStartTime = Date.now();
		console.log(`Running build for ${project}...`);

		const argv = [
			'-b',
			project,
		];

		if (process.argv.includes('--verbose')) {
			argv.push('--verbose');
		}

		const tscPath = path.resolve(process.cwd(), process.argv[3] || 'node_modules/typescript/lib/tsc.js');

		if (process.argv.includes('--workers')) {
			const worker = new Worker(tscPath, { argv });

			worker.on('exit', (code: number) => {
				if (code !== 0) {
					console.error(`ERROR: Cannot build ${project}`);
					process.exit(1);
				}

				console.log(`  ${project} is built successfully in ${durationToStr(Date.now() - projectStartTime)}`);

				projectsTree.setProjectBuilt(project);
				buildInParallel(projectsTree, startTime);
			});
		} else {
			childProcess.exec(
				`node ${tscPath} ${argv.join(' ')}`,
				(error: childProcess.ExecException | null, stdout: string, stderr: string) => {
					if (error !== null) {
						console.error(`Cannot build ${project}:\n${stderr || stdout}`);
						process.exit(1);
					}

					// console.log(stdout);

					console.log(`  ${project} is built successfully in ${durationToStr(Date.now() - projectStartTime)}`);

					projectsTree.setProjectBuilt(project);
					buildInParallel(projectsTree, startTime);
				}
			);
		}
	}
}

function main(): void {
	let project = process.argv[2];
	if (project === undefined) {
		project = path.resolve(process.cwd(), 'tsconfig.json');
	} else {
		project = path.resolve(project);
	}

	const host = ts.createSolutionBuilderHost();
	const builder = ts.createSolutionBuilder(host, [project], { incremental: true }) as any;

	// THIS IS PRIVATE API
	// to force ts read all configs
	void builder.getBuildOrder();

	// THIS IS PRIVATE API
	// it isn't enough to know build order
	// we need to know which one could be run in parallel
	const parsedConfigs: any[] = builder.getAllParsedConfigs();

	const tree = new ProjectsTree();

	for (const proj of parsedConfigs) {
		const deps = proj.projectReferences && proj.projectReferences.map((x: any) => {
			if (ts.sys.fileExists(x.path)) {
				return x.path;
			}

			return ts.findConfigFile(x.path, ts.sys.fileExists);
		});

		tree.addProjectWithDeps(proj.options.configFilePath, deps ? deps : []);
	}

	tree.validateState();

	console.log('build flow:', JSON.stringify(tree.getBuildFlow()));

	buildInParallel(tree, Date.now());
}

main();
