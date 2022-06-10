import React, { useEffect, useState } from 'react';
import {Box, Center, Flex, HStack, Spinner, Button } from "@chakra-ui/react"
import { Octokit } from "@octokit/rest";
import {
    VictoryAxis,
    VictoryChart,
    VictoryHistogram,
    VictoryLabel,
    VictoryTooltip,
    VictoryVoronoiContainer
} from 'victory';
import { DetailsTable } from "./DetailsTable";

const octokit = new Octokit({
    auth: process.env.REACT_APP_GITHUB_TOKEN
});

type Props = {
    owner: string
    repo: string
    workflowId: number
}
const conclusionValues = [
    "success" ,
    "failure" ,
    "cancelled" ,
    "startup_failure",
    "skipped"
] as const;
type Conclusions = typeof conclusionValues[number];

const conclusion2colorScheme = {
    "success": "green",
    "failure": "red",
    "cancelled": "yellow",
    "startup_failure": "facebook",
    "skipped": "gray"
}
const capitalize = s => s && s[0].toUpperCase() + s.slice(1)

type RunDetails = {
    user: string,
    url: string,
    branch: string,
}
type RunResults = {
    duration: number | null,
    details: RunDetails | null,
}

export const WorkflowStats = ({owner, repo, workflowId}: Props) => {
    const [workflowRunsStats, setWorkflowRunsStats] = useState<any>({})
    const [selectedConclusion, setSelectedConclusion] = useState<Conclusions>("success")
    const [selectedDatum, setSelectedDatum] = useState<RunDetails[] | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // TODO: setup proper pagination (potentially with a request limit of 10/20 ?)
        setWorkflowRunsStats({})
        setLoading(true)
        octokit.actions.listWorkflowRuns({
            owner: owner,
            repo: repo,
            workflow_id: workflowId,
            per_page: 100,
        }).then(({data: specificWorkflowRuns}) => {

                const stats = {
                    totalRuns: specificWorkflowRuns.total_count,
                    conclusion: {
                        success: 0,
                        failure: 0,
                        cancelled: 0,
                        startup_failure: 0,
                        skipped: 0
                    },
                    // list of duration of runs in seconds for each conclusion
                    durations: {
                        success: [] as RunResults[],
                        failure: [] as RunResults[],
                        cancelled: [] as RunResults[],
                        startup_failure: [] as RunResults[],
                        skipped: [] as RunResults[],
                    },
                    earliestRun: new Date(8640000000000000).getTime(),
                    latestRun: new Date(-8640000000000000).getTime()
                }
                // only count completed runs
                for (const run of specificWorkflowRuns.workflow_runs) {
                    if (!run.conclusion || run.status !== "completed") continue
                    stats.conclusion[run.conclusion] += 1

                    let createdAtTime = Date.parse(run.created_at)
                    if (run.run_started_at) {
                        createdAtTime = Date.parse(run.run_started_at)
                    }
                    const updatedAtTime = Date.parse(run.updated_at)
                    const durationMs = updatedAtTime - createdAtTime

                    stats.durations[run.conclusion].push({
                        duration: durationMs / 1000,
                        details: {
                            user: (run as any).actor.login,
                            url: run.html_url,
                            branch: run.head_branch,
                        }
                    })

                    stats.earliestRun = Math.min(stats.earliestRun, createdAtTime)
                    stats.latestRun = Math.max(stats.latestRun, createdAtTime)
                }

                console.log("stats", stats)
                setLoading(false)
                setWorkflowRunsStats(stats)
            }
        ).catch(e => {
            setLoading(false)
            console.error("error while getting runs in a workflow from github", e)
        })
    }, [owner, repo, workflowId])

    const handleConclusionSelection = (selection: Conclusions) => {
        setSelectedConclusion(selection);
    }
    return (
        <>
            {loading &&
            (
                <Center pt={150}>
                    <Spinner
                        thickness="4px"
                        speed="0.65s"
                        emptyColor="gray.200"
                        color="blue.500"
                        size="xl"

                    />
                </Center>
            )
            }

            {
                !loading && !!workflowRunsStats?.durations && (
                    <Box display="flex"
                         maxW="1840px"
                         mx="auto"
                         pt={50}
                         justifyContent="center"
                         flexDirection="column"
                    >
                        <>
                            <Flex justifyContent="space-evenly" pt={10}>
                                <Flex>Total Runs: {workflowRunsStats.totalRuns}</Flex>

                                <HStack spacing={4}>
                                    {conclusionValues.map(v => (
                                        <Button size="lg" borderRadius="full" colorScheme={conclusion2colorScheme[v]}
                                                onClick={handleConclusionSelection.bind(null, v)}>
                                            {workflowRunsStats.conclusion[v]} {capitalize(v)}
                                        </Button>
                                    ))}
                                </HStack>


                            </Flex>
                            <br/>
                            Latest Run: {new Date(workflowRunsStats.latestRun).toLocaleDateString()} <br/>
                            Earliest Run: {new Date(workflowRunsStats.earliestRun).toLocaleDateString()} <br/>
                            {capitalize(selectedConclusion)} average duration: {(workflowRunsStats.durations[selectedConclusion].map( element => element.duration / 60 ).reduce((a,b) => a + b, 0) / workflowRunsStats.durations[selectedConclusion].length).toFixed(2) || 0} minutes
                        </>


                        <Flex>
                            <VictoryChart
                                domainPadding={10}
                                width={1000}
                                height={300}
                                containerComponent={
                                    <VictoryVoronoiContainer
                                        labels={({datum}) => `${datum.y} (${(datum.x.toFixed(1))} minutes)`}
                                        labelComponent={<VictoryTooltip cornerRadius={3}
                                                                        flyoutStyle={{fill: "white", stroke: "#999"}}/>}
                                    />}

                            >

                                <VictoryLabel
                                    x={500}
                                    y={25}
                                    textAnchor="middle"
                                    text={`Duration of ${selectedConclusion} runs`}
                                />

                                <VictoryAxis dependentAxis label="Total number of runs"/>
                                <VictoryAxis label="Time (minutes)"/>

                                <VictoryHistogram
                                    style={{data: {fill: `var(--chakra-colors-${conclusion2colorScheme[selectedConclusion]}-500)`, strokeWidth: 0}}}
                                    binSpacing={5}
                                    bins={50} // TODO: make the number of bins dynamic - perhaps a heuristic based on the number of data points?
                                    // data must be in this format: [ {x: t1}, {x: t2}, ... ]
                                    // also convert duration from second to minutes
                                    data={
                                        workflowRunsStats.durations[selectedConclusion].map(({duration, details}) => ({
                                                x: duration / 60,
                                                details
                                        }))
                                    }
                                    events={[{
                                        target: "data",
                                        eventHandlers: {
                                            onClick: () => {
                                                return [
                                                    {
                                                        target: "data",
                                                        mutation: (props) => {
                                                            for (const d of props.datum.binnedData) {
                                                                console.log(d.details.url, d.details)
                                                            }
                                                            setSelectedDatum(props.datum.binnedData.map(a => (a.details)))
                                                            return null;
                                                        }
                                                    }
                                                ];
                                            }
                                        }
                                    }]}
                                />
                            </VictoryChart>
                        </Flex>
                        <Flex>
                            {selectedDatum &&
                                <DetailsTable data={selectedDatum}/>
                            }
                        </Flex>
                    </Box>
                )
            }
        </>
    )
}
