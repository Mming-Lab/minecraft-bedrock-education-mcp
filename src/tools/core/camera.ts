import { BaseTool } from '../base/tool';
import { InputSchema, ToolCallResult } from '../../types';

/**
 * Minecraft Camera Control Tool - Optimized for AI Usage
 * Provides simplified camera manipulation for Minecraft Bedrock Edition
 * Actions are grouped logically to reduce decision complexity for AI systems
 */
export class CameraTool extends BaseTool {
    readonly name = 'camera';
    readonly description = `Controls Minecraft camera view with 6 main actions: move_to (position camera), smooth_move (animated movement), track_entity (follow targets), fade (screen effects), reset (clear camera), set_mode (view presets and controls). Requires cheats enabled.`;
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: [
                    'move_to',
                    'smooth_move', 
                    'track_entity',
                    'fade',
                    'reset',
                    'set_mode',
                    'sequence'
                ],
                description: 'Camera action: move_to=instant positioning, smooth_move=animated movement, track_entity=follow entities, fade=screen effects, reset=clear camera, set_mode=view presets/controls, sequence=cinematic camera sequences'
            },
            x: { type: 'number', description: 'Camera X coordinate' },
            y: { type: 'number', description: 'Camera Y coordinate' },
            z: { type: 'number', description: 'Camera Z coordinate' },
            look_at_x: { type: 'number', description: 'X coordinate to look at (optional)' },
            look_at_y: { type: 'number', description: 'Y coordinate to look at (optional)' },
            look_at_z: { type: 'number', description: 'Z coordinate to look at (optional)' },
            entity: {
                type: 'string',
                description: 'Entity selector to look at or track (@p=nearest player, @e=entities)'
            },
            pitch: { 
                type: 'number', 
                minimum: -90, 
                maximum: 90,
                description: 'Vertical angle: -90=down, 0=horizon, 90=up'
            },
            yaw: { 
                type: 'number', 
                minimum: -180, 
                maximum: 180,
                description: 'Horizontal angle: 0=north, 90=west, -90=east, 180=south'
            },
            duration: { 
                type: 'number', 
                minimum: 0.1,
                default: 3.0,
                description: 'Animation time in seconds (default: 3)'
            },
            easing: {
                type: 'string',
                enum: ['linear', 'smooth', 'bounce', 'elastic'],
                default: 'smooth',
                description: 'Animation style: linear=constant, smooth=ease in/out, bounce=bouncy, elastic=springy'
            },
            fade_in: { 
                type: 'number', 
                minimum: 0,
                default: 1,
                description: 'Fade in time in seconds'
            },
            fade_hold: { 
                type: 'number', 
                minimum: 0,
                default: 1,
                description: 'Hold time in seconds' 
            },
            fade_out: { 
                type: 'number', 
                minimum: 0,
                default: 1,
                description: 'Fade out time in seconds'
            },
            color: {
                type: 'string',
                enum: ['black', 'white', 'red', 'green', 'blue'],
                default: 'black',
                description: 'Fade color'
            },
            mode: {
                type: 'string',
                enum: ['first_person', 'third_person', 'front_view', 'enable_movement', 'disable_movement', 'enable_camera_control', 'disable_camera_control'],
                description: 'View mode or control setting'
            },
            auto_clear: {
                type: 'boolean',
                default: true,
                description: 'Automatically clear camera after action completes'
            },
            shots: {
                type: 'array',
                description: 'Array of camera shots for sequence action. Each shot executes after the previous one completes. Each shot object should have a "type" field (move_to, smooth_move, track_entity, fade, wait) plus relevant parameters like x,y,z coordinates, duration, etc.'
            }
        },
        required: ['action']
    };

    async execute(args: any): Promise<ToolCallResult> {
        const { action } = args;

        try {
            switch (action) {
                case 'move_to':
                    return await this.moveTo(args);
                
                case 'smooth_move':
                    return await this.smoothMove(args);
                
                case 'track_entity':
                    return await this.trackEntity(args);
                
                case 'fade':
                    return await this.fadeEffect(args);
                
                case 'reset':
                    return await this.resetCamera();
                
                case 'set_mode':
                    return await this.setMode(args);
                
                case 'sequence':
                    return await this.executeSequence(args);
                
                default:
                    return this.createErrorResponse(`Unknown camera action: ${action}`);
            }
        } catch (error) {
            return this.createErrorResponse(`Camera error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Instantly moves camera to position with optional look direction
     * Combines position setting with look_at coordinates, entity, or pitch/yaw angles
     */
    private async moveTo(args: any): Promise<ToolCallResult> {
        const { x, y, z, look_at_x, look_at_y, look_at_z, entity, pitch, yaw } = args;
        
        if (!this.validateCoordinates(x, y, z)) {
            return this.createErrorResponse('Invalid camera coordinates');
        }

        const commands: string[] = [];
        
        // Set camera position
        commands.push(`camera @s set minecraft:free pos ${x} ${y} ${z}`);
        
        // Set look direction based on available parameters
        if (look_at_x !== undefined && look_at_y !== undefined && look_at_z !== undefined) {
            if (!this.validateCoordinates(look_at_x, look_at_y, look_at_z)) {
                return this.createErrorResponse('Invalid look_at coordinates');
            }
            commands.push(`camera @s set minecraft:free facing ${look_at_x} ${look_at_y} ${look_at_z}`);
        } else if (entity) {
            commands.push(`camera @s set minecraft:free facing ${entity}`);
        } else if (pitch !== undefined && yaw !== undefined) {
            if (pitch < -90 || pitch > 90 || yaw < -180 || yaw > 180) {
                return this.createErrorResponse('Invalid rotation: pitch (-90 to 90), yaw (-180 to 180)');
            }
            commands.push(`camera @s set minecraft:free rot ${pitch} ${yaw}`);
        }
        
        return this.executeBatch(commands);
    }

    /**
     * Smoothly animates camera movement with easing
     * Supports movement to coordinates with look direction and automatic clearing
     */
    private async smoothMove(args: any): Promise<ToolCallResult> {
        const { x, y, z, look_at_x, look_at_y, look_at_z, entity, pitch, yaw, 
                duration = 3, easing = 'smooth', auto_clear = true } = args;
        
        if (!this.validateCoordinates(x, y, z)) {
            return this.createErrorResponse('Invalid camera coordinates');
        }
        
        if (duration < 0.1) {
            return this.createErrorResponse('Duration must be at least 0.1 seconds');
        }
        
        const easingMap: { [key: string]: string } = {
            'linear': 'linear',
            'smooth': 'in_out_cubic',
            'bounce': 'out_bounce',
            'elastic': 'out_elastic'
        };
        
        const easingType = easingMap[easing] || 'in_out_cubic';
        let command: string;
        
        // Build command based on look direction
        if (look_at_x !== undefined && look_at_y !== undefined && look_at_z !== undefined) {
            if (!this.validateCoordinates(look_at_x, look_at_y, look_at_z)) {
                return this.createErrorResponse('Invalid look_at coordinates');
            }
            command = `camera @s set minecraft:free ease ${duration} ${easingType} pos ${x} ${y} ${z} facing ${look_at_x} ${look_at_y} ${look_at_z}`;
        } else if (entity) {
            command = `camera @s set minecraft:free ease ${duration} ${easingType} pos ${x} ${y} ${z} facing ${entity}`;
        } else if (pitch !== undefined && yaw !== undefined) {
            if (pitch < -90 || pitch > 90 || yaw < -180 || yaw > 180) {
                return this.createErrorResponse('Invalid rotation: pitch (-90 to 90), yaw (-180 to 180)');
            }
            command = `camera @s set minecraft:free ease ${duration} ${easingType} pos ${x} ${y} ${z} rot ${pitch} ${yaw}`;
        } else {
            command = `camera @s set minecraft:free ease ${duration} ${easingType} pos ${x} ${y} ${z}`;
        }
        
        const result = await this.executeCommand(command);
        
        if (auto_clear && result.success) {
            setTimeout(async () => {
                await this.executeCommand('camera @s clear');
            }, (duration + 0.5) * 1000);
        }
        
        return result;
    }

    /**
     * Makes camera track and follow an entity with smooth movement
     */
    private async trackEntity(args: any): Promise<ToolCallResult> {
        const { entity, x, y, z, duration = 3, easing = 'smooth', auto_clear = true } = args;
        
        if (!entity) {
            return this.createErrorResponse('Entity selector is required for tracking');
        }
        
        if (x !== undefined && y !== undefined && z !== undefined) {
            if (!this.validateCoordinates(x, y, z)) {
                return this.createErrorResponse('Invalid camera coordinates');
            }
        }
        
        const easingMap: { [key: string]: string } = {
            'linear': 'linear',
            'smooth': 'in_out_cubic',
            'bounce': 'out_bounce',
            'elastic': 'out_elastic'
        };
        
        const easingType = easingMap[easing] || 'in_out_cubic';
        
        let command: string;
        if (x !== undefined && y !== undefined && z !== undefined) {
            command = `camera @s set minecraft:free ease ${duration} ${easingType} pos ${x} ${y} ${z} facing ${entity}`;
        } else {
            command = `camera @s set minecraft:free facing ${entity}`;
        }
        
        const result = await this.executeCommand(command);
        
        if (auto_clear && result.success && duration > 0) {
            setTimeout(async () => {
                await this.executeCommand('camera @s clear');
            }, (duration + 0.5) * 1000);
        }
        
        return result;
    }

    /**
     * Creates screen fade effect with color and timing
     */
    private async fadeEffect(args: any): Promise<ToolCallResult> {
        const { fade_in = 1, fade_hold = 1, fade_out = 1, color = 'black' } = args;
        
        if (fade_in < 0 || fade_hold < 0 || fade_out < 0) {
            return this.createErrorResponse('Fade times must be non-negative');
        }
        
        const colorMap: { [key: string]: [number, number, number] } = {
            'black': [0, 0, 0],
            'white': [255, 255, 255],
            'red': [255, 0, 0],
            'green': [0, 255, 0],
            'blue': [0, 0, 255]
        };
        
        const [r, g, b] = colorMap[color] || [0, 0, 0];
        
        const command = `camera @s fade time ${fade_in} ${fade_hold} ${fade_out} color ${r} ${g} ${b}`;
        return this.executeCommand(command);
    }

    /**
     * Resets camera to normal view
     */
    private async resetCamera(): Promise<ToolCallResult> {
        return this.executeCommand('camera @s clear');
    }

    /**
     * Sets view mode or controls player input permissions
     */
    private async setMode(args: any): Promise<ToolCallResult> {
        const { mode } = args;
        
        if (!mode) {
            return this.createErrorResponse('Mode parameter is required');
        }
        
        switch (mode) {
            case 'first_person':
                return this.executeCommand('camera @s set minecraft:first_person');
            
            case 'third_person':
                return this.executeCommand('camera @s set minecraft:third_person');
            
            case 'front_view':
                return this.executeCommand('camera @s set minecraft:third_person_front');
            
            case 'enable_movement':
                return this.executeCommand('inputpermission set @s movement enabled');
            
            case 'disable_movement':
                return this.executeCommand('inputpermission set @s movement disabled');
            
            case 'enable_camera_control':
                return this.executeCommand('inputpermission set @s camera enabled');
            
            case 'disable_camera_control':
                return this.executeCommand('inputpermission set @s camera disabled');
            
            default:
                return this.createErrorResponse(`Unknown mode: ${mode}`);
        }
    }

    /**
     * Executes a sequence of camera shots with proper timing
     * Enables cinematic camera work by chaining multiple shots automatically
     */
    private async executeSequence(args: any): Promise<ToolCallResult> {
        const { shots } = args;
        
        if (!shots || !Array.isArray(shots) || shots.length === 0) {
            return this.createErrorResponse('Shots array is required for sequence action');
        }

        try {
            let totalDuration = 0;
            const results: string[] = [];
            
            // Execute shots sequentially with proper timing
            for (let i = 0; i < shots.length; i++) {
                const shot = shots[i];
                const shotResult = await this.executeSingleShot(shot, i);
                
                if (!shotResult.success) {
                    return this.createErrorResponse(`Shot ${i + 1} failed: ${shotResult.message || 'Unknown error'}`);
                }
                
                results.push(`Shot ${i + 1}: ${shotResult.message || 'Executed'}`);
                
                // Calculate and wait for shot duration
                const shotDuration = this.calculateShotDuration(shot);
                totalDuration += shotDuration;
                
                // Wait for this shot to complete before starting the next
                if (i < shots.length - 1 && shotDuration > 0) {
                    await this.delay(shotDuration);
                }
            }
            
            return this.createSuccessResponse(
                `Camera sequence completed: ${shots.length} shots executed over ${totalDuration.toFixed(1)}s\n` +
                results.join('\n')
            );
            
        } catch (error) {
            return this.createErrorResponse(`Sequence execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Executes a single shot within a sequence
     */
    private async executeSingleShot(shot: any, index: number): Promise<ToolCallResult> {
        const { type } = shot;
        
        switch (type) {
            case 'move_to':
                return await this.moveTo(shot);
            
            case 'smooth_move':
                // Disable auto_clear for sequence shots
                return await this.smoothMove({ ...shot, auto_clear: false });
            
            case 'track_entity':
                return await this.trackEntity({ ...shot, auto_clear: false });
            
            case 'fade':
                return await this.fadeEffect(shot);
            
            case 'wait':
                const waitTime = shot.wait_time || 1;
                await this.delay(waitTime);
                return this.createSuccessResponse(`Waited ${waitTime}s`);
            
            default:
                return this.createErrorResponse(`Unknown shot type: ${type}`);
        }
    }

    /**
     * Calculates the duration of a single shot for timing purposes
     */
    private calculateShotDuration(shot: any): number {
        const { type } = shot;
        
        switch (type) {
            case 'move_to':
                return 0.1; // Instant movement, small buffer
            
            case 'smooth_move':
            case 'track_entity':
                return shot.duration || 3;
            
            case 'fade':
                return (shot.fade_in || 1) + (shot.fade_hold || 1) + (shot.fade_out || 1);
            
            case 'wait':
                return shot.wait_time || 1;
            
            default:
                return 0.1;
        }
    }

    /**
     * Promise-based delay utility
     */
    private delay(seconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

}